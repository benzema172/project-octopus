export type AutopilotOwner = "ai" | "human" | "field";
export type AutopilotState = "ready" | "todo" | "blocked" | "done";
export type AutopilotPriority = "critical" | "high" | "medium" | "low";

export type AutopilotMission = {
  id: string;
  title: string;
  description: string;
  owner: AutopilotOwner;
  state: AutopilotState;
  priority: AutopilotPriority;
  category: "decision" | "change" | "material" | "protocol" | "schedule" | "evidence" | "risk" | "finance" | "source";
  actionLabel: string;
  href: string;
  sourceType: string;
  sourceId: string;
  dueAt: string | null;
};

export type ChangeRadarItem = {
  id: string;
  summary: string;
  riskLevel: string;
  targetType: string;
  createdAt: string;
  consequences: string[];
};

export type InstallationMatrixItem = {
  name: string;
  wbsCodes: string[];
  materials: number;
  devices: number;
  boqItems: number;
  materialRequests: number;
  approvedMaterialRequests: number;
  scheduleActivities: number;
  protocolsRequired: number;
  protocolsClosed: number;
  evidenceRequired: number;
  evidenceComplete: number;
  readiness: number;
  state: "ready" | "attention" | "blocked";
};

export type ReconciliationFinding = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  description: string;
  source: "finance" | "warehouse" | "boq";
};

export type AutopilotDecision = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  confidence: number | null;
  category: string;
  detail: string;
};

export type InvestmentAutopilotSnapshot = {
  healthScore: number;
  healthLabel: "stabilna" | "uwaga" | "ryzyko";
  missions: AutopilotMission[];
  nextMission: AutopilotMission | null;
  aiCanDoCount: number;
  humanDecisionCount: number;
  fieldActionCount: number;
  blockerCount: number;
  changeRadar: ChangeRadarItem[];
  installations: InstallationMatrixItem[];
  decisions: AutopilotDecision[];
  reconciliation: {
    acceptedWorkValue: number;
    salesNet: number;
    purchaseNet: number;
    warehouseDocuments: number;
    findings: ReconciliationFinding[];
  };
  lineage: {
    documents: number;
    readyDocuments: number;
    facts: number;
    sourcedFacts: number;
    sourceCoveragePercent: number;
  };
};

export type AutopilotInput = {
  nowIso: string;
  projectId: string;
  workspaceId: string;
  documents: Array<{ id: string; name: string; ai_status: string | null; review_status: string | null }>;
  facts: Array<{ id: string; source_reference_id: string | null; status: string | null }>;
  requirements: Array<{ id: string; requirement_type: string; title: string; description: string | null; status: string; confidence: number | null; source_document_id: string | null }>;
  protocolRequirements: Array<{ id: string; protocol_type: string; title: string; status: string; trigger_rule: unknown; required_evidence: unknown }>;
  protocols: Array<{ id: string; protocol_type: string; title: string; status: string; payload: unknown }>;
  materialRequests: Array<{ id: string; title: string; status: string; payload: unknown }>;
  scheduleActivities: Array<{ id: string; code: string | null; title: string; status: string; planned_start: string | null; planned_finish: string | null; actual_finish: string | null; critical: boolean | null; wbs_node_id: string | null }>;
  impacts: Array<{ id: string; summary: string; risk_level: string; target_type: string; status: string; created_at: string }>;
  evidence: Array<{ id: string; evidence_type: string; title: string; status: string; due_at: string | null; wbs_node_id: string | null }>;
  findings: Array<{ id: string; finding_type: string | null; severity: string; title: string; description: string | null }>;
  materials: Array<{ id: string; name: string; installation: string | null; specification: string | null }>;
  devices: Array<{ id: string; name: string; installation: string | null; parameters: unknown }>;
  wbsNodes: Array<{ id: string; code: string; name: string; installation: string | null; status: string }>;
  boqItems: Array<{ id: string; item_number: string | null; description: string; quantity: number | null; quantity_executed: number | null; quantity_accepted: number | null; unit: string | null; unit_price: number | null; total_price: number | null; wbs_node_id: string | null }>;
  boqVersions: Array<{ id: string; status: string; version_number: number }>;
  aiDecisions: AutopilotDecision[];
  finance: null | {
    allocations: Array<{ id: string; source_type: string; source_id: string; amount: number | null; status: string }>;
    invoices: Array<{ id: string; invoice_number: string; direction: string; net_amount: number | null; status: string }>;
    invoiceLines: Array<{ invoice_id: string; description: string; quantity: number | null; unit: string | null; net_amount: number | null }>;
  };
  warehouse: null | {
    movements: Array<{ id: string; movement_type: string; document_number: string | null; movement_date: string; status: string }>;
    movementLines: Array<{ movement_id: string; stock_item_id: string; quantity: number | null; unit_cost: number | null }>;
    stockItems: Array<{ id: string; name: string; sku: string | null; item_type: string; unit: string }>;
  };
};

const STOP_WORDS = new Set([
  "oraz", "wraz", "instalacja", "instalacji", "system", "roboty", "materiały", "materialy", "usługa", "usluga",
  "dostawa", "montaż", "montaz", "prace", "element", "elementy", "komplet", "projekt", "budowa", "wykonanie", "zakres"
]);

function clean(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(value: string) { return clean(value).split(/\s+/).filter((token) => token.length >= 4 && !STOP_WORDS.has(token)); }
function priorityWeight(priority: AutopilotPriority) { return priority === "critical" ? 0 : priority === "high" ? 1 : priority === "medium" ? 2 : 3; }
function dueWeight(value: string | null) { if (!value) return Number.MAX_SAFE_INTEGER; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER; }

export function changeConsequences(targetType: string, summary = "") {
  const target = clean(targetType), text = clean(summary), result = new Set<string>();
  if (target.includes("wbs") || target.includes("scope")) { result.add("Przelicz WBS i kolejność robót"); result.add("Sprawdź wpływ na harmonogram"); result.add("Zweryfikuj ilości BOQ i przerób"); }
  if (target.includes("boq") || text.includes("kosztorys")) { result.add("Zweryfikuj BOQ i budżet zakresu"); result.add("Zablokuj rozliczenie ponad niezatwierdzony zakres"); }
  if (target.includes("protocol") || text.includes("protokol") || text.includes("proba")) { result.add("Odśwież wymagane protokoły i parametry prób"); result.add("Oznacz starsze szkice odbiorowe do ponownej weryfikacji"); }
  if (target.includes("application") || target.includes("material") || text.includes("material")) { result.add("Zweryfikuj wnioski materiałowe i zamówienia"); result.add("Sprawdź WZ/MM pod kątem zmienionego materiału"); }
  if (target.includes("schedule") || text.includes("termin")) result.add("Przelicz terminy i ścieżkę krytyczną");
  if (text.includes("wentyl")) result.add("Sprawdź zakres pomiarów i regulacji wentylacji");
  if (text.includes("cisn") || text.includes("szczeln")) result.add("Sprawdź parametry i zakres prób ciśnieniowych");
  if (!result.size) { result.add("Sprawdź wpływ na zakres, materiały i dokumenty wykonawcze"); result.add("Potwierdź zmianę przed aktualizacją danych bazowych"); }
  return Array.from(result).slice(0, 5);
}

function riskPriority(value: string): AutopilotPriority {
  const risk = clean(value); if (risk.includes("critical") || risk.includes("kryty")) return "critical"; if (risk.includes("high") || risk.includes("wysok")) return "high"; if (risk.includes("medium") || risk.includes("sred")) return "medium"; return "low";
}
function requirementMission(input: AutopilotInput, row: AutopilotInput["requirements"][number]): AutopilotMission {
  const base = `/workspace/projects/${input.projectId}`, type = clean(row.requirement_type);
  if (type.includes("material")) return { id:`requirement:${row.id}`,title:row.title,description:row.description||"Wymaganie materiałowe rozpoznane w dokumentacji.",owner:"ai",state:"ready",priority:"high",category:"material",actionLabel:"Przygotuj szkic WM",href:`${base}/requests`,sourceType:"project_requirement",sourceId:row.id,dueAt:null };
  if (type.includes("work stage") || type.includes("work_stage")) return { id:`requirement:${row.id}`,title:row.title,description:row.description||"Etap robót wykryty przez Brain.",owner:"ai",state:"ready",priority:"medium",category:"schedule",actionLabel:"Dodaj do planu",href:`${base}/schedule`,sourceType:"project_requirement",sourceId:row.id,dueAt:null };
  if (type.includes("accept")) return { id:`requirement:${row.id}`,title:row.title,description:row.description||"Warunek odbiorowy wymaga potwierdzenia.",owner:"field",state:"todo",priority:"high",category:"evidence",actionLabel:"Wykonaj / potwierdź",href:`${base}/protocols`,sourceType:"project_requirement",sourceId:row.id,dueAt:null };
  return { id:`requirement:${row.id}`,title:row.title,description:row.description||"Wymaganie wymaga decyzji koordynatora.",owner:"human",state:"todo",priority:"medium",category:"decision",actionLabel:"Zweryfikuj",href:`${base}/control`,sourceType:"project_requirement",sourceId:row.id,dueAt:null };
}

function buildInstallations(input: AutopilotInput): InstallationMatrixItem[] {
  const names = new Set<string>();
  for (const row of input.wbsNodes) if (row.installation?.trim()) names.add(row.installation.trim());
  for (const row of input.materials) if (row.installation?.trim()) names.add(row.installation.trim());
  for (const row of input.devices) if (row.installation?.trim()) names.add(row.installation.trim());
  if (!names.size && (input.boqItems.length || input.requirements.length)) names.add("Zakres ogólny");
  const protocolClosed = new Set(input.protocols.filter((row) => ["closed","approved","complete","completed"].includes(clean(row.status))).map((row) => clean(row.protocol_type || row.title)));
  return Array.from(names).map((name) => {
    const keyTokens=tokens(name),wbs=input.wbsNodes.filter((row)=>row.installation===name||tokens(row.installation||"").some((token)=>keyTokens.includes(token))),wbsIds=new Set(wbs.map((row)=>row.id)),wbsCodes=wbs.map((row)=>row.code).filter(Boolean);
    const materials=input.materials.filter((row)=>row.installation===name||tokens(row.installation||"").some((token)=>keyTokens.includes(token))).length,devices=input.devices.filter((row)=>row.installation===name||tokens(row.installation||"").some((token)=>keyTokens.includes(token))).length,boqItems=input.boqItems.filter((row)=>(row.wbs_node_id&&wbsIds.has(row.wbs_node_id))||tokens(row.description).some((token)=>keyTokens.includes(token))).length,scheduleActivities=input.scheduleActivities.filter((row)=>row.wbs_node_id&&wbsIds.has(row.wbs_node_id)).length,evidenceRows=input.evidence.filter((row)=>row.wbs_node_id&&wbsIds.has(row.wbs_node_id));
    const protocolRows=input.protocolRequirements.filter((row)=>{const trigger=row.trigger_rule&&typeof row.trigger_rule==="object"?row.trigger_rule as Record<string,unknown>:{};const code=typeof trigger.wbs==="string"?trigger.wbs:"";return wbsCodes.includes(code)||tokens(row.title).some((token)=>keyTokens.includes(token));});
    const requestRows=input.materialRequests.filter((row)=>{const payload=row.payload&&typeof row.payload==="object"?row.payload as Record<string,unknown>:{};const installation=typeof payload.installation==="string"?payload.installation:"";return tokens(`${row.title} ${installation}`).some((token)=>keyTokens.includes(token));});
    const approvedRequests=requestRows.filter((row)=>["approved","accepted","closed"].includes(clean(row.status))).length,protocolsClosed=protocolRows.filter((row)=>protocolClosed.has(clean(row.protocol_type||row.title))).length,evidenceComplete=evidenceRows.filter((row)=>["accepted","complete","completed","approved"].includes(clean(row.status))).length;
    const readiness=Math.max(0,Math.min(100,(materials+devices+boqItems>0?20:0)+(boqItems>0?20:0)+(requestRows.length===0?(materials+devices?10:20):Math.round(20*approvedRequests/requestRows.length))+(scheduleActivities>0?20:0)+(protocolRows.length===0?20:Math.round(20*protocolsClosed/protocolRows.length))-(evidenceRows.length?Math.round(10*(1-evidenceComplete/evidenceRows.length)):0)));
    return {name,wbsCodes,materials,devices,boqItems,materialRequests:requestRows.length,approvedMaterialRequests:approvedRequests,scheduleActivities,protocolsRequired:protocolRows.length,protocolsClosed,evidenceRequired:evidenceRows.length,evidenceComplete,readiness,state:readiness>=80?"ready":readiness>=50?"attention":"blocked"} satisfies InstallationMatrixItem;
  }).sort((left,right)=>left.readiness-right.readiness||left.name.localeCompare(right.name,"pl"));
}

function buildReconciliation(input: AutopilotInput) {
  const acceptedWorkValue=input.boqItems.reduce((sum,item)=>sum+Math.max(0,Number(item.quantity_accepted??0))*Math.max(0,Number(item.unit_price??0)),0),findings:ReconciliationFinding[]=[];let salesNet=0,purchaseNet=0,warehouseDocuments=0;
  const allocatedInvoiceIds=new Set<string>();
  if(input.finance){for(const allocation of input.finance.allocations)if(allocation.source_type==="invoice"&&["approved","allocated","confirmed"].includes(clean(allocation.status)))allocatedInvoiceIds.add(allocation.source_id);const invoices=input.finance.invoices.filter((row)=>allocatedInvoiceIds.has(row.id));salesNet=invoices.filter((row)=>clean(row.direction)==="sale").reduce((sum,row)=>sum+Number(row.net_amount??0),0);purchaseNet=invoices.filter((row)=>clean(row.direction)==="purchase").reduce((sum,row)=>sum+Number(row.net_amount??0),0);
    if(acceptedWorkValue>0&&salesNet>acceptedWorkValue*1.12)findings.push({id:"sales-over-progress",severity:"high",source:"finance",title:"Sprzedaż wyprzedza odebrany przerób",description:`Sprzedaż netto ${Math.round(salesNet).toLocaleString("pl-PL")} zł jest wyższa niż wartość odebranego BOQ ${Math.round(acceptedWorkValue).toLocaleString("pl-PL")} zł. Zweryfikuj podstawę rozliczenia.`});
    if(acceptedWorkValue>50000&&salesNet<acceptedWorkValue*.72)findings.push({id:"progress-under-invoiced",severity:"medium",source:"finance",title:"Możliwy przerób do zafakturowania",description:"Wartość odebranych robót istotnie przewyższa sprzedaż przypisaną do inwestycji. Sprawdź, czy należy przygotować rozliczenie częściowe."});
    const knownTokens=new Set<string>();for(const text of [...input.materials.map((row)=>row.name),...input.devices.map((row)=>row.name),...input.boqItems.map((row)=>row.description)])for(const token of tokens(text))knownTokens.add(token);const purchaseIds=new Set(invoices.filter((row)=>clean(row.direction)==="purchase").map((row)=>row.id));const unmatched=input.finance.invoiceLines.filter((line)=>purchaseIds.has(line.invoice_id)).filter((line)=>{const rowTokens=tokens(line.description);return rowTokens.length>0&&!rowTokens.some((token)=>knownTokens.has(token));});if(unmatched.length)findings.push({id:"purchase-lines-unmatched",severity:unmatched.length>2?"high":"medium",source:"finance",title:`${unmatched.length} pozycji zakupowych bez mocnego dopasowania do projektu/BOQ`,description:`Octopus nie znalazł jednoznacznego odpowiednika m.in. dla: ${unmatched.slice(0,3).map((row)=>row.description).join("; ")}. Wymagana kontrola przed uznaniem zgodności.`});
  }
  if(input.warehouse){const projectMovements=input.warehouse.movements.filter((row)=>["approved","confirmed","closed"].includes(clean(row.status)));warehouseDocuments=projectMovements.length;const movementIds=new Set(projectMovements.map((row)=>row.id)),stockById=new Map(input.warehouse.stockItems.map((row)=>[row.id,row])),knownTokens=new Set<string>();for(const text of [...input.materials.map((row)=>row.name),...input.devices.map((row)=>row.name),...input.boqItems.map((row)=>row.description)])for(const token of tokens(text))knownTokens.add(token);const usedItems=new Map<string,number>();for(const line of input.warehouse.movementLines){if(!movementIds.has(line.movement_id))continue;usedItems.set(line.stock_item_id,(usedItems.get(line.stock_item_id)??0)+Number(line.quantity??0));}const unmatchedStock=Array.from(usedItems.keys()).map((id)=>stockById.get(id)).filter((row):row is NonNullable<typeof row>=>Boolean(row)).filter((row)=>{const rowTokens=tokens(`${row.sku??""} ${row.name}`);return rowTokens.length>0&&!rowTokens.some((token)=>knownTokens.has(token));});if(unmatchedStock.length)findings.push({id:"warehouse-unmatched",severity:"high",source:"warehouse",title:`${unmatchedStock.length} materiałów WZ/MM bez dopasowania do wiedzy inwestycji`,description:`Sprawdź zgodność materiałową: ${unmatchedStock.slice(0,4).map((row)=>row.name).join(", ")}.`});const approvedRequests=input.materialRequests.filter((row)=>["approved","accepted"].includes(clean(row.status))).length;if(approvedRequests>0&&warehouseDocuments===0)findings.push({id:"approved-without-warehouse",severity:"medium",source:"warehouse",title:"Zatwierdzone materiały bez ruchu magazynowego",description:"Są zaakceptowane wnioski materiałowe, ale inwestycja nie ma jeszcze zatwierdzonego WZ/RW/MM. Sprawdź dostawy i wydania."});}
  for(const item of input.boqItems){const quantity=Number(item.quantity??0),executed=Number(item.quantity_executed??0),accepted=Number(item.quantity_accepted??0);if(quantity>0&&executed>quantity+.001)findings.push({id:`boq-over-${item.id}`,severity:"high",source:"boq",title:`Wykonanie ponad BOQ: ${item.item_number??"pozycja"}`,description:`${item.description}: wykonano ${executed}, plan ${quantity} ${item.unit??""}.`});if(accepted>executed+.001)findings.push({id:`boq-accept-${item.id}`,severity:"high",source:"boq",title:`Odbiór większy od wykonania: ${item.item_number??"pozycja"}`,description:item.description});}
  return {acceptedWorkValue,salesNet,purchaseNet,warehouseDocuments,findings:findings.slice(0,12)};
}

export function buildInvestmentAutopilotSnapshot(input: AutopilotInput): InvestmentAutopilotSnapshot {
  const base=`/workspace/projects/${input.projectId}`,now=Date.parse(input.nowIso),missions:AutopilotMission[]=[];
  for(const decision of input.aiDecisions){if(!["review","error","new","processing"].includes(clean(decision.status)))continue;missions.push({id:`decision:${decision.id}`,title:decision.title,description:decision.detail,owner:"human",state:clean(decision.status)==="error"?"blocked":"todo",priority:clean(decision.status)==="error"?"critical":"high",category:"decision",actionLabel:"Podejmij decyzję",href:`/workspace/companies/${input.workspaceId}/ai-inbox`,sourceType:"ai_inbox",sourceId:decision.id,dueAt:null});}
  for(const impact of input.impacts.filter((row)=>clean(row.status)==="proposed"))missions.push({id:`impact:${impact.id}`,title:"Nowa rewizja wymaga decyzji",description:impact.summary,owner:"human",state:"blocked",priority:riskPriority(impact.risk_level),category:"change",actionLabel:"Sprawdź skutki zmiany",href:`${base}/control`,sourceType:"document_change_impact",sourceId:impact.id,dueAt:null});
  for(const requirement of input.requirements.filter((row)=>!["approved","accepted","closed","rejected","complete","completed"].includes(clean(row.status))))missions.push(requirementMission(input,requirement));
  for(const requirement of input.protocolRequirements.filter((row)=>!["closed","cancelled","rejected"].includes(clean(row.status)))){const matching=input.protocols.find((protocol)=>clean(protocol.protocol_type)===clean(requirement.protocol_type)||clean(protocol.title)===clean(requirement.title));if(matching&&["closed","approved","complete","completed"].includes(clean(matching.status)))continue;missions.push({id:`protocol:${requirement.id}`,title:requirement.title,description:matching?"Szkic istnieje. Uzupełnij wynik rzeczywistej próby, datę, osoby i dowody.":"Octopus może przygotować szkic z danymi projektowymi. Wyniku próby nie wolno wygenerować automatycznie.",owner:matching?"field":"ai",state:matching?"todo":"ready",priority:"high",category:"protocol",actionLabel:matching?"Wykonaj i uzupełnij":"Przygotuj szkic",href:`${base}/protocols`,sourceType:"protocol_requirement",sourceId:requirement.id,dueAt:null});}
  for(const row of input.evidence.filter((item)=>!["accepted","complete","completed","approved"].includes(clean(item.status)))){const overdue=row.due_at?Date.parse(row.due_at)<now:false;missions.push({id:`evidence:${row.id}`,title:row.title,description:`Brakuje dowodu typu ${row.evidence_type}.`,owner:"field",state:overdue?"blocked":"todo",priority:overdue?"critical":"medium",category:"evidence",actionLabel:"Dodaj dowód",href:`${base}/site`,sourceType:"evidence_requirement",sourceId:row.id,dueAt:row.due_at});}
  for(const activity of input.scheduleActivities){if(!activity.critical||["completed","closed","complete"].includes(clean(activity.status))||!activity.planned_finish)continue;if(Date.parse(activity.planned_finish)<now)missions.push({id:`schedule:${activity.id}`,title:`Opóźniona ścieżka krytyczna: ${activity.title}`,description:`Planowany koniec: ${activity.planned_finish}.`,owner:"human",state:"blocked",priority:"critical",category:"schedule",actionLabel:"Przelicz plan",href:`${base}/schedule`,sourceType:"schedule_activity",sourceId:activity.id,dueAt:activity.planned_finish});}
  for(const finding of input.findings.filter((row)=>["critical","warning","high"].includes(clean(row.severity))))missions.push({id:`finding:${finding.id}`,title:finding.title,description:finding.description||"Alert OctopusAI wymaga weryfikacji.",owner:"human",state:clean(finding.severity)==="critical"?"blocked":"todo",priority:clean(finding.severity)==="critical"?"critical":"high",category:"risk",actionLabel:"Zweryfikuj ryzyko",href:`${base}/brain`,sourceType:"ai_finding",sourceId:finding.id,dueAt:null});
  const approvedBoq=input.boqVersions.some((row)=>clean(row.status)==="approved");if(!approvedBoq||input.boqItems.length===0)missions.push({id:"source:boq",title:"Brak zatwierdzonej bazy BOQ",description:"Bez zatwierdzonego kosztorysu Octopus nie może wiarygodnie kontrolować przerobu, zakupów i rozliczeń.",owner:"human",state:"blocked",priority:"critical",category:"source",actionLabel:"Uzupełnij kosztorys",href:`${base}/cost-estimate`,sourceType:"boq",sourceId:input.projectId,dueAt:null});if(input.documents.length===0)missions.push({id:"source:documents",title:"Brak dokumentacji źródłowej",description:"Wrzuć projekt, specyfikację, kosztorys i dokumenty kontraktowe, aby Brain mógł zbudować Project DNA.",owner:"human",state:"blocked",priority:"critical",category:"source",actionLabel:"Dodaj dokumenty",href:`${base}/documentation`,sourceType:"documents",sourceId:input.projectId,dueAt:null});
  const reconciliation=buildReconciliation(input);for(const finding of reconciliation.findings.filter((row)=>row.severity!=="info"))missions.push({id:`reconcile:${finding.id}`,title:finding.title,description:finding.description,owner:"human",state:finding.severity==="high"?"blocked":"todo",priority:finding.severity==="high"?"high":"medium",category:"finance",actionLabel:"Sprawdź zgodność",href:`${base}/control`,sourceType:`reconciliation_${finding.source}`,sourceId:finding.id,dueAt:null});
  const deduped=Array.from(new Map(missions.map((mission)=>[mission.id,mission])).values()).sort((left,right)=>priorityWeight(left.priority)-priorityWeight(right.priority)||dueWeight(left.dueAt)-dueWeight(right.dueAt)||left.title.localeCompare(right.title,"pl"));const aiCanDoCount=deduped.filter((row)=>row.owner==="ai"&&row.state!=="done").length,humanDecisionCount=deduped.filter((row)=>row.owner==="human"&&row.state!=="done").length,fieldActionCount=deduped.filter((row)=>row.owner==="field"&&row.state!=="done").length,blockerCount=deduped.filter((row)=>row.state==="blocked").length,criticalCount=deduped.filter((row)=>row.priority==="critical").length,highCount=deduped.filter((row)=>row.priority==="high").length,healthScore=Math.max(0,Math.min(100,100-criticalCount*10-highCount*4-Math.min(20,blockerCount*3)-Math.min(15,reconciliation.findings.filter((row)=>row.severity==="high").length*5)));
  const changeRadar=input.impacts.filter((row)=>clean(row.status)==="proposed").map((row)=>({id:row.id,summary:row.summary,riskLevel:row.risk_level,targetType:row.target_type,createdAt:row.created_at,consequences:changeConsequences(row.target_type,row.summary)})).sort((left,right)=>priorityWeight(riskPriority(left.riskLevel))-priorityWeight(riskPriority(right.riskLevel))||Date.parse(right.createdAt)-Date.parse(left.createdAt));const facts=input.facts.length,sourcedFacts=input.facts.filter((row)=>Boolean(row.source_reference_id)).length,readyDocuments=input.documents.filter((row)=>["ready","review"].includes(clean(row.ai_status||""))).length;
  return {healthScore,healthLabel:healthScore>=80?"stabilna":healthScore>=55?"uwaga":"ryzyko",missions:deduped,nextMission:deduped[0]??null,aiCanDoCount,humanDecisionCount,fieldActionCount,blockerCount,changeRadar,installations:buildInstallations(input),decisions:input.aiDecisions.filter((row)=>["review","error","new","processing"].includes(clean(row.status))).slice(0,12),reconciliation,lineage:{documents:input.documents.length,readyDocuments,facts,sourcedFacts,sourceCoveragePercent:facts?Math.round(sourcedFacts/facts*100):0}};
}
