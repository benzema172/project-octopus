"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function num(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:1}).format(Number.isFinite(n)?n:0); }
function str(value: unknown,fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function HrOperations({ workspaceId,data,canWrite,pathname,query }: { workspaceId:string; data:Data; canWrite:boolean; pathname:string; query:string }) {
  const employees=(data.employees??[]) as Row[], employments=(data.employments??[]) as Row[], qualifications=(data.qualifications??[]) as Row[], exams=(data.exams??[]) as Row[], leaves=(data.leaves??[]) as Row[], timesheets=(data.timesheets??[]) as Row[], projects=(data.projects??[]) as Row[], summary=(data.summary??{}) as Row;
  const names=new Map(employees.map(row=>[String(row.id),`${str(row.first_name,"")} ${str(row.last_name,"")}`.trim()]));
  const employeeOptions=employees.map(row=>({...row,name:names.get(String(row.id))}));
  const employmentByEmployee=new Map<string,Row>(); employments.forEach(row=>{const id=String(row.employee_id);if(!employmentByEmployee.has(id))employmentByEmployee.set(id,row);});
  const forms:FormSpec[]=[
    {title:"Dodaj pracownika",entity:"employee",success:"Pracownik i zatrudnienie zostały zapisane.",wide:true,fields:[{name:"firstName",label:"Imię",required:true},{name:"lastName",label:"Nazwisko",required:true},{name:"employeeNumber",label:"Numer pracownika"},{name:"email",label:"E-mail",type:"email"},{name:"phone",label:"Telefon"},{name:"employmentType",label:"Forma zatrudnienia",type:"select",options:[["employment_contract","Umowa o pracę"],["contract","Umowa cywilna"],["b2b","B2B"]]},{name:"position",label:"Stanowisko"},{name:"hiredAt",label:"Data zatrudnienia",type:"date"},{name:"monthlyCost",label:"Koszt miesięczny",type:"number"},{name:"hourlyCost",label:"Koszt godzinowy",type:"number"}]},
    {title:"Dodaj uprawnienie",entity:"qualification",success:"Uprawnienie zostało zapisane.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"qualificationType",label:"Rodzaj",required:true,placeholder:"SEP, UDT, F-gazy"},{name:"number",label:"Numer"},{name:"validUntil",label:"Ważne do",type:"date"}]},
    {title:"Badanie medyczne",entity:"medical_exam",success:"Badanie medyczne zostało zapisane.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"examType",label:"Rodzaj",required:true},{name:"examinedAt",label:"Data badania",type:"date"},{name:"validUntil",label:"Ważne do",type:"date",required:true},{name:"result",label:"Wynik",type:"select",options:[["fit","Zdolny"],["fit_with_restrictions","Zdolny z ograniczeniami"],["unfit","Niezdolny"]]}]},
    {title:"Czas pracy",entity:"timesheet",success:"Czas pracy został zapisany.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólny"},{name:"workDate",label:"Data",type:"date"},{name:"hours",label:"Godziny",type:"number",required:true},{name:"overtimeHours",label:"Nadgodziny",type:"number"}]},
    {title:"Wniosek urlopowy",entity:"leave_request",success:"Wniosek urlopowy został zapisany.",fields:[{name:"employeeId",label:"Pracownik z tej strony",rows:employeeOptions,required:true},{name:"dateFrom",label:"Od",type:"date",required:true},{name:"dateTo",label:"Do",type:"date",required:true},{name:"leaveType",label:"Rodzaj",type:"select",options:[["annual","Wypoczynkowy"],["on_demand","Na żądanie"],["unpaid","Bezpłatny"],["sick","Chorobowe"]]},{name:"days",label:"Liczba dni",type:"number",required:true}]}
  ];
  const metrics=[
    {label:"Pracownicy aktywni",value:str(summary.activeEmployees,"0"),caption:`${str(summary.records,"0")} osób w kartotece`},
    {label:"Godziny",value:`${num(summary.hours)} h`,caption:"Globalny czas pracy"},
    {label:"Terminy do 30 dni",value:str(summary.expiring30,"0"),caption:`${str(summary.expired,"0")} już wygasłych`},
    {label:"Urlopy oczekujące",value:str(summary.pendingLeaves,"0"),caption:"Wymagają decyzji"}
  ];
  return <CompanyModuleShell workspaceId={workspaceId} data={data} canWrite={canWrite} pathname={pathname} query={query} metrics={metrics} forms={forms} rows={employees} tableTitle="Pracownicy" emptyLabel="Brak pracowników dla bieżącego filtra." columns={[
    {label:"Pracownik",value:row=><strong>{names.get(String(row.id))}</strong>},
    {label:"Numer",value:row=>str(row.employee_number)},
    {label:"Stanowisko",value:row=>str(employmentByEmployee.get(String(row.id))?.position,"Bez stanowiska")},
    {label:"Kontakt",value:row=><span>{str(row.email)}<br/>{str(row.phone)}</span>},
    {label:"Od",value:row=>str(employmentByEmployee.get(String(row.id))?.valid_from ?? row.hired_at)},
    {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
  ]}>
    <section className="ops-split-lists"><article className="ops-panel"><h3>Dane bieżącej strony</h3><p>{qualifications.length} uprawnień · {exams.length} badań · {timesheets.length} wpisów czasu.</p><p>Relacje kadrowe są odczytywane wyłącznie dla pracowników widocznych na stronie.</p></article><article className="ops-panel"><h3>Urlopy na stronie</h3>{leaves.slice(0,8).map(row=><p key={String(row.id)}><strong>{names.get(String(row.employee_id))??"Pracownik"}</strong><br/>{str(row.date_from)}–{str(row.date_to)} · {str(row.status)}</p>)}</article></section>
  </CompanyModuleShell>;
}
