"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function money(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function num(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:1}).format(Number.isFinite(n)?n:0); }
function str(value: unknown,fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function FleetOperations({ workspaceId,data,canWrite,canApprove,pathname,query }: { workspaceId:string; data:Data; canWrite:boolean; canApprove:boolean; pathname:string; query:string }) {
  const vehicles=(data.vehicles??[]) as Row[], service=(data.service??[]) as Row[], documents=(data.documents??[]) as Row[], projects=(data.projects??[]) as Row[], employees=(data.employees??[]) as Row[], summary=(data.summary??{}) as Row;
  const vehicleOptions=vehicles.map(row=>({...row,name:`${str(row.registration_number)} · ${str(row.make,"")} ${str(row.model,"")}`.trim()}));
  const employeeOptions=employees.map(row=>({...row,name:`${str(row.first_name,"")} ${str(row.last_name,"")}`.trim()}));
  const openService=service.filter(row=>!["closed","cancelled"].includes(String(row.status))).map(row=>({...row,name:`${str(row.service_type)} · ${str(row.opened_at,"bez daty")}`})) as Array<Row & {name:string}>;
  const forms:FormSpec[]=[
    {title:"Dodaj pojazd / maszynę",entity:"vehicle",success:"Pojazd został zapisany.",wide:true,fields:[{name:"registrationNumber",label:"Rejestracja",required:true},{name:"vin",label:"VIN"},{name:"vehicleType",label:"Typ",type:"select",options:[["car","Samochód"],["van","Dostawczy"],["truck","Ciężarowy"],["machine","Maszyna"]]},{name:"make",label:"Marka"},{name:"model",label:"Model"},{name:"productionYear",label:"Rok",type:"number"},{name:"ownershipType",label:"Własność",type:"select",options:[["owned","Własny"],["lease","Leasing"],["rental","Wynajem"]]},{name:"currentMileage",label:"Przebieg",type:"number"}]},
    {title:"Tankowanie",entity:"fuel_entry",success:"Tankowanie zostało zapisane.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Bez kierowcy"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Koszt ogólny"},{name:"fueledAt",label:"Data",type:"datetime-local"},{name:"liters",label:"Litry",type:"number",required:true},{name:"grossAmount",label:"Kwota",type:"number",required:true},{name:"mileage",label:"Przebieg",type:"number"}]},
    {title:"Przejazd",entity:"trip",success:"Przejazd został zapisany.",wide:true,fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Bez kierowcy"},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Przejazd ogólny"},{name:"startedAt",label:"Start",type:"datetime-local"},{name:"finishedAt",label:"Koniec",type:"datetime-local"},{name:"startLocation",label:"Skąd"},{name:"endLocation",label:"Dokąd"},{name:"distanceKm",label:"Dystans km",type:"number",required:true},{name:"purpose",label:"Cel przejazdu",required:true}]},
    {title:"Serwis",entity:"service_order",success:"Serwis został zapisany.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"serviceType",label:"Rodzaj serwisu",required:true},{name:"openedAt",label:"Otwarcie",type:"date"},{name:"cost",label:"Koszt",type:"number"},{name:"nextDueDate",label:"Następna data",type:"date"},{name:"nextDueMileage",label:"Następny przebieg",type:"number"}]},
    {title:"Dokument i termin",entity:"vehicle_document",success:"Dokument został zapisany.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"documentType",label:"Rodzaj",type:"select",options:[["inspection","Badanie techniczne"],["insurance","OC / AC"],["lease","Leasing"],["permit","Pozwolenie / UDT"]]},{name:"number",label:"Numer"},{name:"validFrom",label:"Od",type:"date"},{name:"validUntil",label:"Ważne do",type:"date"}]},
    {title:"Zgłoś szkodę",entity:"damage_case",success:"Szkoda została zarejestrowana.",fields:[{name:"vehicleId",label:"Pojazd z tej strony",rows:vehicleOptions,required:true},{name:"employeeId",label:"Kierowca",rows:employeeOptions,placeholder:"Nie przypisano"},{name:"occurredAt",label:"Data zdarzenia",type:"datetime-local"},{name:"description",label:"Opis szkody",required:true},{name:"cost",label:"Szacowany koszt",type:"number"}]},
    {title:"Zmień status pojazdu",entity:"vehicle_status",success:"Status pojazdu został zmieniony.",fields:[{name:"vehicleId",label:"Pojazd",rows:vehicleOptions,required:true},{name:"status",label:"Status",type:"select",required:true,options:[["active","Aktywny"],["service","W serwisie"],["inactive","Nieaktywny"],["sold","Sprzedany"]]}]},
    ...(openService.length?[{title:"Zamknij serwis",entity:"service_close",success:"Serwis został zamknięty i koszt zaktualizowany.",fields:[{name:"serviceId",label:"Otwarte zlecenie",rows:openService,required:true},{name:"closedAt",label:"Data zamknięcia",type:"date" as const},{name:"cost",label:"Koszt końcowy",type:"number" as const}]} satisfies FormSpec]:[])
  ];
  const totalCost=Number(summary.totalCost??0), distance=Number(summary.distanceKm??0);
  const metrics=[
    {label:"Dokumenty do 30 dni",value:str(summary.due30,"0"),caption:`${str(summary.expired,"0")} już wygasłych`},
    {label:"Serwisy do 30 dni",value:str(summary.serviceDue30,"0"),caption:"Wymagają zaplanowania"},
    {label:"Otwarte szkody",value:str(summary.openDamages,"0"),caption:"Sprawy niezakończone"},
    {label:"Pojazdy aktywne",value:str(summary.activeVehicles,"0"),caption:`${str(summary.records,"0")} pojazdów i maszyn`},
    {label:"Koszt floty",value:money(totalCost),caption:"Paliwo + serwis + szkody"},
    {label:"Koszt / km",value:distance>0?`${money(summary.costPerKm)}/km`:"—",caption:`${num(distance)} km przejazdów`},
    {label:"Brak przebiegu",value:str(summary.missingMileage,"0"),caption:"Aktywne pojazdy bez wiarygodnej bazy km"},
    {label:"Uprawnienia",value:canApprove?"Zatwierdzanie":"Operacyjne",caption:"Zmiany kontrolowane przez role domenowe"}
  ];
  return <CompanyModuleShell
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    pathname={pathname}
    query={query}
    metrics={metrics}
    forms={forms}
    rows={vehicles}
    tableTitle="Pojazdy i maszyny"
    emptyLabel="Brak pojazdów dla bieżącego filtra."
    detailTitle={row=>`${str(row.registration_number)} · ${`${str(row.make,"")} ${str(row.model,"")}`.trim() || "Pojazd"}`}
    detailContent={row=>{
      const vehicleId=String(row.id);
      const vehicleDocuments=documents.filter(item=>String(item.vehicle_id ?? item.vehicleId)===vehicleId).slice(0,6);
      const vehicleService=service.filter(item=>String(item.vehicle_id ?? item.vehicleId)===vehicleId).slice(0,6);
      return <>
        <section><h3>Dane pojazdu</h3><p>VIN: <strong>{str(row.vin)}</strong><br/>Przebieg: <strong>{num(row.current_mileage)} km</strong> · własność: <strong>{str(row.ownership_type)}</strong></p><p>Rok: {str(row.production_year)} · typ: {str(row.vehicle_type)} · status: {str(row.status)}</p></section>
        <section><h3>Dokumenty i terminy</h3>{vehicleDocuments.map(item=><p key={String(item.id)}><strong>{str(item.document_type)}</strong> · {str(item.number,"bez numeru")}<br/>Ważne do {str(item.valid_until,"bez terminu")}</p>)}{!vehicleDocuments.length?<p>Brak dokumentów przypisanych do pojazdu.</p>:null}</section>
        <section><h3>Serwis</h3>{vehicleService.map(item=><p key={String(item.id)}><strong>{str(item.service_type)}</strong> · {money(item.cost)}<br/>Otwarto {str(item.opened_at,"bez daty")} · następny termin {str(item.next_due_date,"—")} · {str(item.status)}</p>)}{!vehicleService.length?<p>Brak historii serwisowej.</p>:null}</section>
      </>;
    }}
    columns={[
      {label:"Rejestracja",value:row=><strong>{str(row.registration_number)}</strong>},
      {label:"Pojazd",value:row=>`${str(row.make,"")} ${str(row.model,"")}`.trim() || "—"},
      {label:"Typ",value:row=>str(row.vehicle_type)},
      {label:"Przebieg",value:row=>`${num(row.current_mileage)} km`},
      {label:"Własność",value:row=>str(row.ownership_type)},
      {label:"Status",value:row=><span className="status-chip">{str(row.status)}</span>}
    ]}
  >
    <section className="ops-split-lists ops-secondary-section">
      <article className="ops-panel"><h3>Koszt i wykorzystanie</h3><p><strong>{money(summary.fuelCost)}</strong> paliwo · <strong>{money(summary.serviceCost)}</strong> serwis · <strong>{money(summary.damageCost)}</strong> szkody.</p><p>{num(distance)} km · średnio {distance>0?`${money(summary.costPerKm)}/km`:"brak danych do kosztu/km"}.</p></article>
      <article className="ops-panel"><h3>Terminy i ryzyka</h3><p>{str(summary.expired,"0")} wygasłych dokumentów · {str(summary.due30,"0")} w 30 dni.</p><p>{str(summary.serviceDue30,"0")} serwisów w 30 dni · {str(summary.openDamages,"0")} otwartych szkód.</p>{documents.slice(0,4).map(row=><p key={String(row.id)}><strong>{str(row.document_type)}</strong><br/>{str(row.valid_until,"bez terminu")}</p>)}</article>
    </section>
    {openService.length?<section className="ops-panel ops-panel--compact-list"><h3>Otwarte serwisy</h3>{openService.slice(0,8).map(row=><p key={String(row.id)}><strong>{str(row.service_type)}</strong> · otwarto {str(row.opened_at,"—")} · {money(row.cost)} · {str(row.status)}</p>)}</section>:null}
  </CompanyModuleShell>;
}
