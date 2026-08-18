"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function money(value: unknown) { const n=Number(value ?? 0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function str(value: unknown, fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function FinanceOperations({ workspaceId, data, canWrite, pathname, query }: { workspaceId:string; data:Data; canWrite:boolean; pathname:string; query:string }) {
  const invoices=(data.invoices ?? []) as Row[], counterparties=(data.counterparties ?? []) as Row[], projects=(data.projects ?? []) as Row[];
  const allocations=(data.allocations ?? []) as Row[], lines=(data.invoiceLines ?? []) as Row[], payments=(data.payments ?? []) as Row[], commitments=(data.commitments ?? []) as Row[];
  const summary=(data.summary ?? {}) as Row;
  const cpNames=new Map(counterparties.map(row=>[String(row.id),String(row.name)]));
  const projectNames=new Map(projects.map(row=>[String(row.id),String(row.name)]));
  const allocationByInvoice=new Map(allocations.map(row=>[String(row.source_id),row]));
  const invoiceOptions=invoices.map(row=>({...row,name:`${str(row.invoice_number)} · ${money(row.gross_amount)}`}));
  const forms:FormSpec[]=[
    {title:"Dodaj kontrahenta",entity:"counterparty",success:"Kontrahent został dodany.",fields:[{name:"name",label:"Nazwa",required:true},{name:"taxId",label:"NIP"},{name:"role",label:"Rola",type:"select",options:[["supplier","Dostawca"],["customer","Klient"],["subcontractor","Podwykonawca"]]}]},
    {title:"Zarejestruj fakturę",entity:"invoice",success:"Faktura została zapisana i przypisana.",wide:true,fields:[{name:"invoiceNumber",label:"Numer",required:true},{name:"direction",label:"Rodzaj",type:"select",required:true,options:[["purchase","Zakupowa"],["sale","Sprzedażowa"]]},{name:"counterpartyId",label:"Kontrahent",rows:counterparties,placeholder:"Bez przypisania"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólnofirmowy"},{name:"issueDate",label:"Data wystawienia",type:"date"},{name:"dueDate",label:"Termin płatności",type:"date"},{name:"netAmount",label:"Netto",type:"number"},{name:"taxAmount",label:"VAT",type:"number"},{name:"grossAmount",label:"Brutto",type:"number",required:true},{name:"lineDescription",label:"Opis głównej pozycji"},{name:"lineQuantity",label:"Ilość",type:"number"},{name:"lineUnit",label:"Jednostka"},{name:"lineUnitPrice",label:"Cena jednostkowa",type:"number"}]},
    {title:"Zarejestruj płatność",entity:"payment",success:"Płatność została zapisana.",fields:[{name:"invoiceId",label:"Faktura z tej strony",rows:invoiceOptions,required:true},{name:"paymentDate",label:"Data",type:"date"},{name:"amount",label:"Kwota",type:"number",required:true},{name:"bankReference",label:"Referencja"}]},
    {title:"Dodaj zobowiązanie",entity:"commitment",success:"Zobowiązanie dodano do cash flow.",fields:[{name:"description",label:"Opis",required:true},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólnofirmowy"},{name:"amount",label:"Wartość",type:"number",required:true},{name:"expectedDate",label:"Planowana data",type:"date"}]}
  ];
  const metrics=[
    {label:"Sprzedaż brutto",value:money(summary.salesGross),caption:`${str(summary.records,"0")} faktur w firmie`},
    {label:"Zakupy brutto",value:money(summary.purchasesGross),caption:"Globalnie, nie tylko bieżąca strona"},
    {label:"Rozliczono",value:money(summary.paidGross),caption:"Suma zarejestrowanych płatności"},
    {label:"Do rozliczenia",value:money(summary.openGross),caption:`${str(summary.openCount,"0")} otwartych rozrachunków`}
  ];
  return <CompanyModuleShell workspaceId={workspaceId} data={data} canWrite={canWrite} pathname={pathname} query={query} metrics={metrics} forms={forms} rows={invoices} tableTitle="Faktury i rozrachunki" emptyLabel="Brak faktur dla bieżącego filtra." columns={[
    {label:"Dokument",value:row=><strong>{str(row.invoice_number)}</strong>},
    {label:"Kontrahent",value:row=>cpNames.get(String(row.counterparty_id)) ?? "—"},
    {label:"Przypisanie",value:row=>{const a=allocationByInvoice.get(String(row.id));return a?projectNames.get(String(a.project_id)) ?? "Inwestycja":"Koszty ogólne";}},
    {label:"Brutto",value:row=>money(row.gross_amount)},
    {label:"Pozostało",value:row=>money(Number(row.gross_amount??0)-Number(row.paid_amount??0))},
    {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
  ]}>
    <section className="ops-split-lists"><article className="ops-panel"><h3>Dane bieżącej strony</h3><p>{lines.length} pozycji faktur · {payments.length} płatności · {allocations.length} alokacji.</p><p>Rekordy zależne są pobierane wyłącznie dla faktur widocznych na stronie.</p></article><article className="ops-panel"><h3>Najbliższe zobowiązania</h3>{commitments.slice(0,8).map(row=><p key={String(row.id)}><strong>{str(row.description)}</strong><br/>{money(row.amount)} · {str(row.expected_date,"bez terminu")}</p>)}</article></section>
  </CompanyModuleShell>;
}
