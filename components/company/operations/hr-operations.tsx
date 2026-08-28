"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function num(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:1}).format(Number.isFinite(n)?n:0); }
function money(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function str(value: unknown,fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function HrOperations({ workspaceId,data,canWrite,canApprove,pathname,query }: { workspaceId:string; data:Data; canWrite:boolean; canApprove:boolean; pathname:string; query:string }) {
  const employees=(data.employees??[]) as Row[], employments=(data.employments??[]) as Row[], leaves=(data.leaves??[]) as Row[], timesheets=(data.timesheets??[]) as Row[], projects=(data.projects??[]) as Row[], summary=(data.summary??{}) as Row;
  const names=new Map(employees.map(row=>[String(row.id),`${str(row.first_name,"")} ${str(row.last_name,"")}`.trim()]));
  const employeeOptions=employees.map(row=>({...row,name:names.get(String(row.id))}));
  const employmentByEmployee=new Map<string,Row>(); employments.forEach(row=>{const id=String(row.employee_id);if(!employmentByEmployee.has(id))employmentByEmployee.set(id,row);});
  const pendingLeaves=leaves.filter(row=>["pending","submitted","review"].includes(String(row.status))).map(row=>({...row,name:`${names.get(String(row.employee_id))??"Pracownik"} · ${str(row.date_from)}–${str(row.date_to)}`})) as Array<Row & {name:string}>;
  const pendingTimesheets=timesheets.filter(row=>["draft","submitted","pending"].includes(String(row.status))).map(row=>({...row,name:`${names.get(String(row.employee_id))??"Pracownik"} · ${str(row.work_date)} · ${num(row.hours)} h`})) as Array<Row & {name:string}>;
  const pendingDecisions=Number(summary.pendingLeaves??0)+Number(summary.pendingTimesheets??0);
  const forms:FormSpec[]=[
    {title:"Dodaj pracownika",entity:"employee",success:"Pracownik i zatrudnienie zostały zapisane.",wide:true,fields:[{name:"firstName",label:"Imię",required:true},{name:"lastName",label:"Nazwisko",required:true},{name:"employeeNumber",label:"Numer pracownika"},{name:"email",label:"E-mail",type:"email"},{name:"phone",label:"Telefon"},{name:"employmentType",label:"Forma zatrudnienia",type:"select",options:[["employment_contract","Umowa o pracę"],["contract","Umowa cywilna"],["b2b","B2B"]]},{name:"position",label:"Stanowisko"},{name:"hiredAt",label:"Data zatrudnienia",type:"date"},...(canApprove?[{name:"netMonthlyPay",label:"Wypłata netto",type:"number" as const},{name:"grossMonthlyPay",label:"Wynagrodzenie brutto",type:"number" as const},{name:"employerContributions",label:"ZUS / składki pracodawcy",type:"number" as const},{name:"otherMonthlyCosts",label:"Pozostałe koszty",type:"number" as const},{name:"nominalMonthlyHours",label:"Nominalne godziny miesiąca",type:"number" as const}]:[])]},
    {title:"Dodaj uprawnienie",entity:"qualification",success:"Uprawnienie zostało zapisane.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"qualificationType",label:"Rodzaj",required:true,placeholder:"SEP, UDT, F-gazy"},{name:"number",label:"Numer"},{name:"validUntil",label:"Ważne do",type:"date"}]},
    {title:"Badanie medyczne",entity:"medical_exam",success:"Badanie medyczne zostało zapisane.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"examType",label:"Rodzaj",required:true},{name:"examinedAt",label:"Data badania",type:"date"},{name:"validUntil",label:"Ważne do",type:"date",required:true},{name:"result",label:"Wynik",type:"select",options:[["fit","Zdolny"],["fit_with_restrictions","Zdolny z ograniczeniami"],["unfit","Niezdolny"]]}]},
    {title:"Czas pracy",entity:"timesheet",success:"Czas pracy został zapisany.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólny"},{name:"workDate",label:"Data",type:"date"},{name:"hours",label:"Godziny",type:"number",required:true},{name:"overtimeHours",label:"Nadgodziny",type:"number"}]},
    {title:"Wniosek urlopowy",entity:"leave_request",success:"Wniosek urlopowy został zapisany.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"dateFrom",label:"Od",type:"date",required:true},{name:"dateTo",label:"Do",type:"date",required:true},{name:"leaveType",label:"Rodzaj",type:"select",options:[["annual","Wypoczynkowy"],["on_demand","Na żądanie"],["unpaid","Bezpłatny"],["sick","Chorobowe"]]},{name:"days",label:"Liczba dni",type:"number",required:true}]},
    {title:"Zmień status pracownika",entity:"employee_status",success:"Status pracownika został zmieniony.",fields:[{name:"employeeId",label:"Pracownik",rows:employeeOptions,required:true},{name:"status",label:"Nowy status",type:"select",required:true,options:[["active","Aktywny"],["inactive","Nieaktywny"],["terminated","Zakończone zatrudnienie"]]},{name:"terminatedAt",label:"Data zakończenia",type:"date"}]},
    ...(canApprove&&pendingLeaves.length?[{title:"Decyzja urlopowa",entity:"leave_decision",success:"Decyzja urlopowa została zapisana.",fields:[{name:"leaveId",label:"Wniosek",rows:pendingLeaves,required:true},{name:"decision",label:"Decyzja",type:"select" as const,required:true,options:[["approved","Zatwierdź"],["rejected","Odrzuć"]]}]} satisfies FormSpec]:[]),
    ...(canApprove&&pendingTimesheets.length?[{title:"Zatwierdź czas pracy",entity:"timesheet_decision",success:"Decyzja czasu pracy została zapisana.",fields:[{name:"timesheetId",label:"Wpis czasu",rows:pendingTimesheets,required:true},{name:"decision",label:"Decyzja",type:"select" as const,required:true,options:[["approved","Zatwierdź"],["rejected","Odrzuć"]]}]} satisfies FormSpec]:[])
  ];
  const metrics=[
    {label:"Pracownicy aktywni",value:str(summary.activeEmployees,"0"),caption:`${str(summary.records,"0")} osób w kartotece`},
    {label:"Terminy do 30 dni",value:str(summary.expiring30,"0"),caption:`${str(summary.expired,"0")} już wygasłych`},
    {label:"Do zatwierdzenia",value:String(pendingDecisions),caption:`${str(summary.pendingLeaves,"0")} urlopów · ${str(summary.pendingTimesheets,"0")} kart czasu`},
    {label:"Godziny",value:`${num(summary.hours)} h`,caption:"Łączny zarejestrowany czas pracy"},
    {label:"Koszt pracy",value:money(summary.approvedLaborCost),caption:"Zatwierdzone godziny × koszt godzinowy"},
    {label:"Urlopy oczekujące",value:str(summary.pendingLeaves,"0"),caption:canApprove?"Możesz podjąć decyzję":"Wymagają zatwierdzenia"},
    {label:"Czas do zatwierdzenia",value:str(summary.pendingTimesheets,"0"),caption:"Wpływa na koszt inwestycji po akceptacji"},
    {label:"Wydany sprzęt",value:str(summary.issuedAssets,"0"),caption:"Aktywnie przypisane zasoby"}
  ];
  return <CompanyModuleShell
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    pathname={pathname}
    query={query}
    metrics={metrics}
    forms={forms}
    rows={employees}
    tableTitle="Pracownicy"
    emptyLabel="Brak pracowników dla bieżącego filtra."
    detailTitle={row=>names.get(String(row.id)) ?? "Pracownik"}
    detailContent={row=>{
      const employment=employmentByEmployee.get(String(row.id));
      const employeeLeaves=leaves.filter(item=>String(item.employee_id)===String(row.id)).slice(0,4);
      const employeeTimesheets=timesheets.filter(item=>String(item.employee_id)===String(row.id)).slice(0,5);
      return <>
        <section><h3>Zatrudnienie</h3><p><strong>{str(employment?.position,"Bez stanowiska")}</strong><br/>{str(employment?.employment_type,"Forma nieuzupełniona")} · od {str(employment?.valid_from ?? row.hired_at)}</p><p>Koszt miesięczny: <strong>{money(employment?.monthly_cost)}</strong> · godzinowy: <strong>{money(employment?.hourly_cost)}</strong></p></section>
        <section><h3>Ostatnie urlopy</h3>{employeeLeaves.map(item=><p key={String(item.id)}><strong>{str(item.date_from)}–{str(item.date_to)}</strong> · {str(item.leave_type)} · {str(item.status)}</p>)}{!employeeLeaves.length?<p>Brak wpisów urlopowych.</p>:null}</section>
        <section><h3>Ostatni czas pracy</h3>{employeeTimesheets.map(item=><p key={String(item.id)}><strong>{str(item.work_date)}</strong> · {num(item.hours)} h · {str(item.status)}</p>)}{!employeeTimesheets.length?<p>Brak zarejestrowanego czasu.</p>:null}</section>
      </>;
    }}
    columns={[
      {label:"Pracownik",value:row=><strong>{names.get(String(row.id))}</strong>},
      {label:"Numer",value:row=>str(row.employee_number)},
      {label:"Stanowisko",value:row=>str(employmentByEmployee.get(String(row.id))?.position,"Bez stanowiska")},
      {label:"Kontakt",value:row=><span>{str(row.email)}<br/>{str(row.phone)}</span>},
      {label:"Od",value:row=>str(employmentByEmployee.get(String(row.id))?.valid_from ?? row.hired_at)},
      {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
    ]}
  >
    <section className="ops-split-lists ops-secondary-section">
      <article className="ops-panel"><h3>Kontrola zgodności HR</h3><p><strong>{str(summary.expired,"0")}</strong> wygasłych badań/uprawnień · <strong>{str(summary.expiring30,"0")}</strong> terminów w 30 dni.</p><p>{str(summary.pendingTimesheets,"0")} kart czasu i {str(summary.pendingLeaves,"0")} urlopów oczekuje na decyzję.</p></article>
      {pendingDecisions ? <article className="ops-panel"><h3>Oczekujące decyzje</h3>{pendingLeaves.slice(0,4).map(row=><p key={`l-${String(row.id)}`}><strong>{str(row.name)}</strong><br/>Urlop · {str(row.status)}</p>)}{pendingTimesheets.slice(0,4).map(row=><p key={`t-${String(row.id)}`}><strong>{str(row.name)}</strong><br/>Czas pracy · {str(row.status)}</p>)}</article> : <article className="ops-panel"><h3>Oczekujące decyzje</h3><p>Brak zaległych decyzji kadrowych.</p></article>}
    </section>
  </CompanyModuleShell>;
}
