"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function money(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function num(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:1}).format(Number.isFinite(n)?n:0); }
function str(value: unknown,fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function FleetOperations({ workspaceId,data,canWrite,pathname,query }: { workspaceId:string; data:Data; canWrite:boolean; pathname:string; query:string }) {
  const vehicles=(data.vehicles??[]) as Row[], fuel=(data.fuel??[]) as Row[], trips=(data.trips??[]) as Row[], service=(data.service??[]) as Row[], documents=(data.documents??[]) as Row[], damages=(data.damages??[]) as Row[], projects=(data.projects??[]) as Row[], employees=(data.employees??[]) as Row[], summary=(data.summary??{}) as Row;
  const vehicleOptions=vehicles.map(row=>({...row,name:`${str(row.registration_number)} · ${str(row.make,"")} ${str(row.model,"")}`.trim()}));
  const employeeOptions=employees.map(row=>({...row,name:`${str(row.first_name,"")} ${str(row.last_name,"")}`.trim()}));
  const forms:FormSpec[]=[
    {title:"Dodaj pojazd / maszynę",entity:"vehicle",success:"Pojazd został zapisany.",wide:true,fields:[{name:"registrationNumber",label:"Rejestracja",required:true},{name:"vin",label:"VIN"},{name:"vehicleType",label:"Typ",type:"select",options:[["car","Samochód"],["van","Dostawczy"],["truck","Ciężarowy"],["machine","Maszyna"]]},{name:"make",label:"Marka"},{name:"model",label:"Model"},{name:"productionYear",label:"Rok",type:"number"},{name:"ownershipType",label:"Własność",type:"select",options:[["owned","Własny"],["lease","Leasing"],["rental","Wynajem"]]},{name:"currentMileage",label:"Przebieg",type:"number"}]},
    {title:"Tankowanie",entity:"fuel_entry",success:"Tankowanie zostało zapisane.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Bez kierowcy"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólny"},{name:"fueledAt",label:"Data",type:"datetime-local"},{name:"liters",label:"Litry",type:"number",required:true},{name:"grossAmount",label:"Kwota",type:"number",required:true},{name:"mileage",label:"Przebieg",type:"number"}]},
    {title:"Przejazd",entity:"trip",success:"Przejazd został zapisany.",wide:true,fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Bez kierowcy"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Przejazd ogólny"},{name:"startedAt",label:"Start",type:"datetime-local"},{name:"finishedAt",label:"Koniec",type:"datetime-local"},{name:"startLocation",label:"Skąd"},{name:"endLocation",label:"Dokąd"},{name:"distanceKm",label:"Dystans km",type:"number",required:true},{name:"purpose",label:"Cel przejazdu",required:true}]},
    {title:"Serwis",entity:"service_order",success:"Serwis został zapisany.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"serviceType",label:"Rodzaj serwisu",required:true},{name:"openedAt",label:"Otwarcie",type:"date"},{name:"cost",label:"Koszt",type:"number"},{name:"nextDueDate",label:"Następna data",type:"date"},{name:"nextDueMileage",label:"Następny przebieg",type:"number"}]},
    {title:"Dokument i termin",entity:"vehicle_document",success:"Dokument został zapisany.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"documentType",label:"Rodzaj",type:"select",options:[["inspection","Badanie techniczne"],["insurance","OC / AC"],["lease","Leasing"],["permit","Pozwolenie / UDT"]]},{name:"number",label:"Numer"},{name:"validFrom",label:"Od",type:"date"},{name:"validUntil",label:"Ważne do",type:"date"}]},
    {title:"Zgłoś szkodę",entity:"damage_case",success:"Szkoda została zarejestrowana.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Nie przypisano"},{name:"occurredAt",label:"Data zdarzenia",type:"datetime-local"},{name:"description",label:"Opis szkody",required:true},{name:"cost",label:"Szacowany koszt",type:"number"}]}
  ];
  const totalCost=Number(summary.fuelCost??0)+Number(summary.serviceCost??0)+Number(summary.damageCost??0), distance=Number(summary.distanceKm??0);
  const metrics=[
    {label:"Pojazdy aktywne",value:str(summary.activeVehicles,"0"),caption:`${str(summary.records,"0")} pojazdów i maszyn`},
    {label:"Koszt floty",value:money(totalCost),caption:"Paliwo + serwis + szkody"},
    {label:"Koszt / km",value:distance>0?`${money(totalCost/distance)}/km`:"—",caption:`${num(distance)} km przejazdów`},
    {label:"Terminy do 30 dni",value:str(summary.due30,"0"),caption:`${str(summary.expired,"0")} wygasłych dokumentów`}
  ];
  return <CompanyModuleShell workspaceId={workspaceId} data={data} canWrite={canWrite} pathname={pathname} query={query} metrics={metrics} forms={forms} rows={vehicles} tableTitle="Pojazdy i maszyny" emptyLabel="Brak pojazdów dla bieżącego filtra." columns={[
    {label:"Rejestracja",value:row=><strong>{str(row.registration_number)}</strong>},
    {label:"Pojazd",value:row=>`${str(row.make,"")} ${str(row.model,"")}`.trim() || "—"},
    {label:"Typ",value:row=>str(row.vehicle_type)},
    {label:"Przebieg",value:row=>`${num(row.current_mileage)} km`},
    {label:"Własność",value:row=>str(row.ownership_type)},
    {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
  ]}>
    <section className="ops-split-lists"><article className="ops-panel"><h3>Dane bieżącej strony</h3><p>{fuel.length} tankowań · {trips.length} przejazdów · {service.length} serwisów.</p><p>Historia jest pobierana wyłącznie dla pojazdów widocznych na stronie.</p></article><article className="ops-panel"><h3>Dokumenty i szkody</h3><p>{documents.length} dokumentów · {damages.length} szkód dla bieżącej strony.</p></article></section>
  </CompanyModuleShell>;
}
