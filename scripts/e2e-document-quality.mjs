/** Live integration fixtures run only in the existing dedicated guest audit workspace. */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
const base = process.env.E2E_BASE_URL;
if (!base || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw Error("Missing public live-test configuration");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function api(path, token, body) {
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(310_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`${path}: HTTP ${res.status} ${data.error ?? ""}`);
  return data;
}
const guest = await api("/api/auth/guest", null, { login: process.env.E2E_GUEST_LOGIN, password: process.env.E2E_GUEST_PASSWORD });
const signed = await db.auth.signInWithPassword({ email: guest.email, password: guest.password });
if (signed.error || !signed.data.session) throw Error("Guest audit sign-in failed");
const token = signed.data.session.access_token, workspaceId = guest.workspaceId;
const projects = await db.from("projects").select("id,name").eq("workspace_id", workspaceId).eq("status", "active").limit(1);
if (projects.error || !projects.data?.length) throw Error("Missing dedicated audit project");
const projectId = projects.data[0].id;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function upload(fileName, mimeType, bytes, category) {
  // AI may rename documents; the immutable uploaded filename identifies the fixture.
  const existing = await db.from("document_versions").select("document_id,documents!document_versions_document_id_fkey!inner(workspace_id)")
    .eq("documents.workspace_id", workspaceId).eq("project_id", projectId).eq("file_name", fileName)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  const documentId = existing.data?.document_id;
  if (documentId) {
    const document = await db.from("documents").select("deleted_at").eq("id", documentId).eq("workspace_id", workspaceId).single();
    if (document.error) throw document.error;
    if (document.data.deleted_at) await api("/api/storage/document-state", token, { workspaceId, projectId, documentId, state: "active" });
  }
  console.log(`Checking live fixture: ${fileName}`);
  const url = await api("/api/storage/upload-url", token, { workspaceId, projectId, ...(documentId ? { documentId } : {}), fileName, mimeType, fileSize: bytes.length, ...(category ? {category,categoryLocked:true} : {}) });
  const stored = await fetch(url.uploadUrl, { method: "PUT", headers: url.headers, body: bytes });
  if (!stored.ok) throw Error(`R2 fixture upload failed: ${stored.status}`);
  return api("/api/storage/complete", token, { token: url.token, sha256: sha(bytes) });
}
async function processVersion(versionId) { return api("/api/brain/process", token, { workspaceId, versionId }); }
async function extraction(versionId) {
  const result = await db.from("document_extractions").select("payload").eq("workspace_id", workspaceId).eq("document_version_id", versionId).eq("extraction_type", "document_context").eq("schema_version", "document-analysis-v3").single();
  if (result.error) throw result.error;
  if (result.data.payload.fieldQuality?.version !== "field-quality-v1") throw Error("Detailed field validation was not persisted");
  if (result.data.payload.fieldQuality.rulesVersion !== "typed-spans-20261114") throw Error("The deployed typed-span validation rules were not used");
  return result.data.payload;
}
function spreadsheet(bad) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Lp", "Opis", "Ilość", "Jm", "Cena jednostkowa", "Wartość"], [],
    ["1", "Rura testowa DN50", 10, "m", 20, bad ? 0 : 200]
  ]), "Kosztorys");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Lp", "Zadanie", "Start", "Koniec"], ["S1", "Montaż rur", "2026-11-10", bad ? "2026-11-09" : "2026-11-12"]
  ]), "Harmonogram");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
const summary = [];
for (const bad of [false, true]) {
  const fixture = await upload(`octopus-live-field-quality-${bad ? "conflict" : "valid"}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", spreadsheet(bad));
  await processVersion(fixture.versionId);
  const data = await extraction(fixture.versionId);
  const total = data.fieldQuality.fields.find(field => field.path === "boqItems.0.totalPrice");
  if (!total || total.source?.cell !== "F3") throw Error("Lost physical Excel cell provenance");
  if (bad && (total.status !== "conflict" || !data.fieldQuality.requiresReview)) throw Error("Explicit zero / arithmetic conflict was not caught");
  if (!bad && total.status !== "verified") throw Error("Native Excel value was not verified");
  const proposals = await db.from("document_module_proposals").select("status,payload,proposal_type").eq("document_version_id", fixture.versionId).eq("proposal_type", "boq_item");
  if (proposals.error) throw proposals.error;
  if (bad && proposals.data.some(row => row.status === "published")) throw Error("Conflicting estimate reached publication");
  const view = await api(`/api/documents/quality?workspaceId=${workspaceId}&documentId=${fixture.documentId}`, token);
  if (!view.totalFields || view.report.documentVersionId !== fixture.versionId) throw Error("Quality UI endpoint did not expose the current report");
  const anon = await fetch(`${base}/api/documents/quality?workspaceId=${workspaceId}&documentId=${fixture.documentId}`);
  if (anon.status !== 401) throw Error("Quality endpoint lacks authentication");
  summary.push({ fixture: bad ? "conflicting_excel" : "valid_excel", cell: total.source.cell, status: total.status, fields: data.fieldQuality.fields.length, guarded: bad ? true : undefined });
}
// Native cell parsing must retain the sign and grouped decimal instead of cleaning
// them into a different, apparently valid value. No model answer is mocked here.
const signedBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(signedBook, XLSX.utils.aoa_to_sheet([
  ["Lp", "Opis", "Ilość", "Jm", "Cena jednostkowa", "Wartość"],
  ["N1", "Korekta ilości rury DN50", "(10)", "m", 20, "(200)"],
  ["N2", "Zawór testowy DN50", 2, "szt.", "1.234,56", "2.469,12"],
  ["N3", "Rura z nieczytelną ilością", "0 nieczytelne", "m", 20, 0]
]), "Kosztorys");
const signedFixture = await upload("octopus-live-field-quality-typed-spans.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from(XLSX.write(signedBook, { type: "buffer", bookType: "xlsx" })));
await processVersion(signedFixture.versionId);
const signedData = await extraction(signedFixture.versionId);
const findField = path => signedData.fieldQuality.fields.find(field => field.path === path);
for (const [path, value, cell] of [["boqItems.0.quantity", -10, "C2"], ["boqItems.0.totalPrice", -200, "F2"], ["boqItems.1.unitPrice", 1234.56, "E3"], ["boqItems.1.totalPrice", 2469.12, "F3"]]) {
  const field = findField(path);
  if (field?.value !== value || field.status !== "verified" || field.source?.cell !== cell) throw Error(`Native signed/grouped source corrupted: ${path} ${JSON.stringify(field)}`);
}
if (findField("boqItems.2.quantity")?.status !== "missing" || !signedData.fieldQuality.requiresReview) throw Error("Unreadable numeric text was accepted as a native zero");
const typedProposals = await db.from("document_module_proposals").select("status,payload,source_locator").eq("document_version_id", signedFixture.versionId).eq("proposal_type", "boq_item");
if (typedProposals.error) throw typedProposals.error;
if (typedProposals.data.length !== 3) throw Error("Native typed-span fixture did not produce the expected BOQ proposals");
const unreadable = typedProposals.data.find(row => row.source_locator?.analysisPath === "boqItems.2");
if (!unreadable?.payload.fieldQuality?.requiresReview || unreadable.status === "published") throw Error("Unreadable cell reached publication or lost its source row identity");
if (typedProposals.data.some(row => !row.source_locator?.analysisPath || row.payload.fieldQuality.rulesVersion !== "typed-spans-20261114")) throw Error("Published proposal lost its typed-span provenance");
summary.push({ fixture: "typed_spans_excel", signedQuantity: -10, signedTotal: -200, groupedTotal: 2469.12, unreadableCellGuarded: true, sourceRowIdentity: true });
const progressBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(progressBook, XLSX.utils.aoa_to_sheet([
  ["Lp", "Opis", "Wykonano", "Odebrano", "Jm"],
  ["P1", "Montaż rur — ilość nieczytelna", "0 nieczytelne", 0, "m"]
]), "Przeroby");
const progressFixture = await upload("octopus-live-field-quality-progress.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from(XLSX.write(progressBook, { type: "buffer", bookType: "xlsx" })));
await processVersion(progressFixture.versionId);
const progressData = await extraction(progressFixture.versionId);
const executed = progressData.fieldQuality.fields.find(field => field.path === "progressItems.0.quantityExecuted");
if (progressData.progressItems.length !== 1 || executed?.status !== "missing" || executed.source?.cell !== "C2") throw Error("Unreadable progress source disappeared or became a verified zero");
const progressProposals = await db.from("document_module_proposals").select("status,payload,source_locator").eq("document_version_id", progressFixture.versionId).eq("proposal_type", "progress_claim");
if (progressProposals.error) throw progressProposals.error;
if (progressProposals.data.length !== 1 || !progressProposals.data[0].payload.fieldQuality?.requiresReview || progressProposals.data[0].status === "published" || progressProposals.data[0].source_locator?.analysisPath !== "progressItems.0") throw Error("Unreadable progress was not held with its original row identity");
summary.push({ fixture: "unreadable_progress_excel", cell: "C2", rowPreserved: true, publicationGuarded: true });
const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const lines of [
  ["INDEPENDENT DOCUMENT 1 - COST ESTIMATE EST-QA-01", "Project Octopus test investment", "Item | Description | Quantity | Unit | Unit price PLN | Total PLN", "1 | Steel pipe DN50 | 10 | m | 20 | 200", "END OF COST ESTIMATE"],
  ["INDEPENDENT DOCUMENT 2 - CONSTRUCTION SCHEDULE SCH-QA-02", "Project Octopus test investment", "Task S1: Pipe installation", "Planned start: 2026-11-10", "Planned finish: 2026-11-12", "END OF SCHEDULE"],
  ["INDEPENDENT DOCUMENT 3 - ACCEPTANCE PROTOCOL PV-QA-03", "Date: 2026-11-12", "Scope: pipe pressure test", "Installation: water supply DN50", "Result: NOT ACCEPTED - leak at joint", "Repair deadline: 2026-11-15", "END OF PROTOCOL"]
]) {
  const page = pdf.addPage([612, 792]); lines.forEach((line, i) => page.drawText(line, { x: 35, y: 740 - i * 35, size: i ? 10 : 12, font }));
}
const bytes = Buffer.from(await pdf.save());
const fixture = await upload("octopus-live-field-quality-mixed.pdf", "application/pdf", bytes);
const processed = await processVersion(fixture.versionId);
if (processed.package?.acceptedEntries !== 3 || processed.package.queuedVersionIds?.length !== 3) throw Error(`Mixed PDF was not split into three documents: ${JSON.stringify(processed.package ?? processed.status)}`);
const children = [];
for (const versionId of processed.package.queuedVersionIds) {
  await processVersion(versionId); const data = await extraction(versionId);
  children.push({ category: data.category, fields: data.fieldQuality.fields.length });
  const origin = await db.from("document_intakes").select("source_metadata").eq("workspace_id", workspaceId).eq("document_id", data.fieldQuality.documentId).single();
  if (origin.error || origin.data.source_metadata.parentVersionId !== fixture.versionId || origin.data.source_metadata.pdfLogicalChild !== true) throw Error("Child lost its original PDF lineage");
}
if (new Set(children.map(child => child.category)).size < 2) throw Error("Independent children were routed as one document type");
const signedUrl = await api("/api/storage/download-url", token, { workspaceId, versionId: fixture.versionId, disposition: "inline" });
const original = Buffer.from(await (await fetch(signedUrl.downloadUrl)).arrayBuffer());
if (sha(original) !== sha(bytes)) throw Error("Original PDF changed during segmentation");
summary.push({ fixture: "mixed_pdf", children, originalPreserved: true });
await checkConstructionFlow();
console.log("LIVE FIELD QUALITY E2E OK"); console.log(JSON.stringify(summary));

async function checkConstructionFlow() {
  const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const prefix = "octopus-live-construction-v1";
  const tag = "OCT-NOV-B17", scope = "OCT-PIPE-17", reference = "SPEC-17";
  async function file(label, mime, bytes, category) {
    const fixture = await upload(prefix + "-" + label, mime, bytes, category);
    await processVersion(fixture.versionId);
    return {...fixture,data:await extraction(fixture.versionId)};
  }
  function workbook(sheets) {
    const book = XLSX.utils.book_new();
    for (const [name,rows] of sheets) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);
    return Buffer.from(XLSX.write(book,{type:"buffer",bookType:"xlsx"}));
  }
  const boq = await file("przedmiar.xlsx",xlsxMime,workbook([
    ["Przedmiar",[["Nr pozycji","Opis","Kondygnacja","WBS","Kod produktu","Wariant","Ilość","Jm","Cena","Wartość"],
      [tag,"Pompa","Parter","W1","OCT-P17","DN40",1,"szt",10,10],[tag,"Pompa","Piętro","W2","OCT-P17","DN50",2,"szt",10,20]]],
    ["Korekty",[["Nr pozycji","Kondygnacja","Rewizja","Ilość","Wartość"],[tag,"Piętro","R2",3,30]]]
  ]),"estimate");
  if (boq.data.boqItems.length !== 2 || boq.data.boqItems[0].totalPrice !== 10 || boq.data.boqItems[1].totalPrice !== 30 ||
      !boq.data.fieldEvidence.some(e => e.path === "boqItems.1.totalPrice" && e.locator.includes("Korekty") && e.cell === "E2")) throw Error("Incorrect cross-sheet revision provenance");
  const drafts = await db.from("document_module_proposals").select("payload,status").eq("document_version_id",boq.versionId).eq("proposal_type","schedule_activity");
  const inferred = drafts.data?.filter(r => r.payload.derivedFromBoq);
  if (drafts.error || inferred?.length !== 2 || inferred.some(r => r.status === "published" || r.payload.plannedStart || !r.payload.fieldQuality.requiresReview)) throw Error("Missing or prematurely published BOQ schedule drafts");
  const card = await file("karta.xlsx",xlsxMime,workbook([["Karta materiałowa",[["Opis","Kod produktu","Wariant","Jm","Producent"],["Pompa","OCT-P17","DN50","szt","Octopus Test"]]]]),"application");
  const section = await PDFDocument.create();
  const font = await section.embedFont(StandardFonts.Helvetica);
  const page = section.addPage();
  ["TECHNICAL SPECIFICATION - ACCEPTANCE CRITERION",reference+" | "+scope+" | test pressure >= 5 bar",
    "BOQ "+tag+" | WBS W2 | "+scope+" | "+reference+" | test pressure >= 5 bar"].forEach((line,i)=>page.drawText(line,{x:30,y:760-i*35,size:11,font}));
  const spec = await file("specification.pdf","application/pdf",Buffer.from(await section.save()),"specification");
  await api("/api/brain/review",token,{workspaceId,projectId,entityType:"document",entityId:spec.documentId,action:"approve",category:"specification",note:"Synthetic acceptance fixture"});
  const z = XLSX.CFB.utils.cfb_new();
  const add = (path,xml) => XLSX.CFB.utils.cfb_add(z,path,Buffer.from(xml));
  const w="http://schemas.openxmlformats.org/wordprocessingml/2006/main",rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const p=t=>"<w:p><w:r><w:t>"+t+"</w:t></w:r></w:p>", cells=xs=>"<w:tr>"+xs.map(x=>"<w:tc>"+x+"</w:tc>").join("")+"</w:tr>";
  add("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>');
  const relationships=items=>'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+items+'</Relationships>';
  add("_rels/.rels",relationships('<Relationship Id="r1" Type="'+rel+'/officeDocument" Target="word/document.xml"/>'));
  add("word/_rels/document.xml.rels",relationships('<Relationship Id="f" Type="'+rel+'/footnotes" Target="footnotes.xml"/>'));
  add("word/footnotes.xml",'<w:footnotes xmlns:w="'+w+'" xmlns:r="'+rel+'"><w:footnote w:id="1"><w:p><w:hyperlink r:id="photo"><w:r><w:t>Zdjęcie próby</w:t></w:r></w:hyperlink></w:p></w:footnote></w:footnotes>');
  add("word/_rels/footnotes.xml.rels",relationships('<Relationship Id="photo" Type="'+rel+'/hyperlink" Target="https://example.org/fixture.pdf" TargetMode="External"/>'));
  add("word/document.xml",'<w:document xmlns:w="'+w+'"><w:body>'+p("Protokół próby szczelności")+'<w:tbl>'+
    cells(["Odcinek","Ciśnienie próby","Jednostka","Punkt specyfikacji","Uwagi"].map(p))+
    cells([p("OCT-OTHER"),p("5"),p(""),p(reference),p("Sprawdzić")])+
    cells([p(scope),p("0,5"),p("MPa"),p(reference),'<w:tbl>'+cells([p("nie odebrano")])+'</w:tbl><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>'])+'</w:tbl></w:body></w:document>');
  const protocol=await file("protokol.docx",docxMime,Buffer.from(XLSX.CFB.write(z,{type:"buffer",fileType:"zip"})),"protocol");
  async function findings(kind) {
    const result=[]; let total;
    do { const page=await api("/api/projects/construction-review?projectId="+projectId+"&kind="+kind+"&offset="+result.length,token); result.push(...page.items); total=page.total; if (!page.items.length) break; } while(result.length<total);
    return result;
  }
  const matches=await findings("materials"), measures=await findings("protocols"), tasks=await findings("schedule");
  const linked=(row,version)=>row.sources.some(s=>s.versionId===version);
  if (!matches.some(r=>linked(r,card.versionId)&&linked(r,boq.versionId)&&r.status.startsWith("Proponowane powiązanie"))) throw Error("Real product card not linked to BOQ");
  if (!tasks.some(r=>linked(r,boq.versionId)&&linked(r,spec.versionId))) throw Error("Missing specification clause on BOQ task");
  if (!measures.some(r=>linked(r,protocol.versionId)&&linked(r,spec.versionId)&&r.status==="Pomiar spełnia kryterium")) throw Error("Pressure boundary not linked to approved specification");
  if (!measures.some(r=>r.title.startsWith("OCT-OTHER")&&r.status.startsWith("Do weryfikacji"))) throw Error("Missing-unit pressure accepted");
  if (!measures.some(r=>r.title===scope&&r.status.includes("nie odebrano")&&r.links?.[0]?.href==="https://example.org/fixture.pdf")) throw Error("Nested DOCX note or attached footnote lost");
  const anonymous=await fetch(base+"/api/projects/construction-review?projectId="+projectId+"&kind=materials");
  if (anonymous.status!==401) throw Error("Construction review requires a session");
  summary.push({fixture:"cross_document_construction",matchedRevision:"R2",boqRows:2,heldScheduleDrafts:2,materialVariant:"DN50",approvedSpec:reference,pressure:"0.5 MPa",scopedFootnote:true});
}
