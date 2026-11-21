import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
vi.mock("server-only", () => ({}));
import { extractSpreadsheetIntelligence } from "../lib/documents/spreadsheet-intelligence";
import { attachmentTarget, readWordDocument } from "../lib/documents/word-tables";
import { buildConstructionSource, pressure, meetsCriterion, readConstructionEvidence, type ConstructionEvidence } from "../lib/documents/construction-evidence";
import { projectSourceReview, type SourceDocument } from "../lib/documents/project-source-review";
import type { DocumentAnalysis } from "../lib/ai/gemini-document";

function workbook(location: string, extra: unknown[][] = []) {
  const book = XLSX.utils.book_new();
  const table = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  table("Korekty", [["Nr pozycji","Kondygnacja","Rewizja","Ilość","Wartość"],["B1",location,"R2",3,30], ...extra]);
  table("Przedmiar",[["Nr pozycji","Kondygnacja","Opis","Jm","Ilość","Cena","Wartość"],["B1","Parter","Rura","m",1,10,10],["B1","Piętro","Rura","m",2,10,20]]);
  return extractSpreadsheetIntelligence(XLSX.write(book,{type:"buffer",bookType:"xlsx"}));
}
const context = { boqItems: [], materialRequirements: [], scheduleItems: [] } as unknown as DocumentAnalysis;
const doc = (category: string, approved = true): SourceDocument => ({ category, name: category, versionId: category+"-v2", approved, source: buildConstructionSource(context,category) });
const item = { id:"B1",title:"Pompa",location:"P1",wbs:"W1",code:"P-44",variant:"DN50",unit:"szt",locator:"A3",quote:"P-44 DN50",revision:"",review:false };
const evidence: ConstructionEvidence = { kind:"criterion",scope:"A1", itemNumber:"B1",wbs:"W1",code:"",variant:"",metric:"ciśnienie próby",unit:"bar",valueText:"≥ 5 bar",reference:"§ 2",locator:"str. 2",quote:"A1 · § 2 · ciśnienie próby ≥ 5 bar" };

describe("obieg dokumentów inwestycji", () => {
  it("nakłada korektę tylko na właściwy wiersz i zachowuje fizyczną komórkę rewizji", () => {
    const result = workbook("Piętro");
    expect(result.boqItems.map(x => [x.location,x.totalPrice,x.revision])).toEqual([["Parter",10,""],["Piętro",30,"R2"]]);
    expect(result.fieldEvidence.find(x => x.path === "boqItems.1.quantity")?.locator).toContain("Korekty, wiersz 2, komórka D2");
    expect(result.workbookReview).toEqual([]);
  });
  it("wstrzymuje niejednoznaczne identyfikatory i powtórzone rewizje", () => {
    for (const result of [workbook(""),workbook("Piętro",[["B1","Piętro","R2",4,40]])]) {
      expect(result.workbookReview.length).toBeGreaterThan(0); expect(result.boqItems.map(x => x.totalPrice)).toEqual([10,20]);
    }
  });
  it("przypisuje zagnieżdżoną uwagę i adres przypisu do jednego odcinka", () => {
    const rel = '<Relationships><Relationship Id="r1" Type="urn:test/hyperlink" Target="https://example.org/zal.pdf"/></Relationships>';
    const txt = (t:string) => '<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>';
    const cell = (s:string) => '<w:tc>'+s+'</w:tc>';
    const row = (a:string,b:string) => '<w:tr>'+cell(txt(a))+cell(b)+'</w:tr>';
    const xml = '<w:document><w:tbl>'+row("Odcinek",txt("Uwagi"))+row("Parter",txt("OK"))+row("Piętro",'<w:tbl><w:tr>'+cell(txt("nie odebrano"))+'</w:tr></w:tbl><w:footnoteReference w:id="1"/>')+'</w:tbl></w:document>';
    const files: Record<string,string> = {"word/document.xml":xml,"word/footnotes.xml":'<w:footnotes><w:footnote w:id="1"><w:hyperlink r:id="r1">'+txt("Zdjęcie")+'</w:hyperlink></w:footnote></w:footnotes>',"word/_rels/footnotes.xml.rels":rel};
    const parsed = readWordDocument(k => files[k]); const source = buildConstructionSource(context,"protocol",parsed.text,parsed.rows);
    expect(source.observations[0]).toMatchObject({scope:"Parter",note:"OK",links:[]});
    expect(source.observations[1]).toMatchObject({scope:"Piętro",locator:"Tabela 1, wiersz 3",links:[{target:"https://example.org/zal.pdf"}]});
    expect(source.observations[1].note).toContain("nie odebrano"); expect(attachmentTarget("../zal.pdf")).toBe("");
  });
  it("porównuje próg z właściwej zatwierdzonej specyfikacji i oznacza brak jednostki", () => {
    const spec = doc("specification"), protocol = doc("protocol");spec.source.entries=[evidence];
    protocol.source.entries=[{...evidence,kind:"measurement",valueText:"0,5 MPa",unit:"MPa"}];
    expect(projectSourceReview([spec,protocol],"protocols")[0].status).toBe("Pomiar spełnia kryterium");
    for (const other of [{...spec,approved:false}, {...spec,source:{...spec.source,entries:[{...evidence,scope:"A2"}]}}])
      expect(projectSourceReview([other,protocol],"protocols")[0].status).toContain("Do weryfikacji");
    expect(pressure("5","",false)).toBeNull();
    expect([4.9,5,5.1].map(x=>meetsCriterion(x, {value:5,operator:">="}))).toEqual([false,true,true]);
    expect(meetsCriterion(5,{value:5,operator:">"})).toBe(false);
    expect(readConstructionEvidence([{...evidence, code:"BŁĘDNY"}])[0].code).toBe("");
  });
  it("łączy wariant i jednostkę, pokazuje oba źródła i nie zgaduje przy dwóch dopasowaniach", () => {
    const bo = doc("estimate"), card = doc("application");bo.source.boq=[item,{...item,id:"B2",variant:"DN65"}];
    card.source.entries=[{...evidence,kind:"product",itemNumber:"",wbs:"",code:"P-44",variant:"DN65",unit:"szt"}];
    const compare = () => projectSourceReview([bo,card],"materials")[0]; expect(compare().status).toContain("B2");expect(compare().sources.length).toBe(2);
    bo.source.boq.push({...item,id:"B3",variant:"DN65"});expect(compare().status).toContain("Do weryfikacji");
  });
  it("porównuje kody harmonogramu i zachowuje punkt specyfikacji przy propozycji zadania", () => {
    const bo=doc("estimate"),plan=doc("schedule"),spec=doc("specification");bo.source.boq=[item];spec.source.entries=[evidence];
    plan.source.plan=[{code:"EXTRA",wbs:"W2",title:"Inne",locator:"A4",quote:"Dodatkowe"}];
    const review=projectSourceReview([bo,plan,spec],"schedule");expect(review[0].sources[1].versionId).toBe("specification-v2");
    expect(review[0].status).toContain("Brak kodu");expect(review[1].status).toContain("bez odpowiadającego kodu");
  });
});
