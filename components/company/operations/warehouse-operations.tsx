"use client";

import { WarehouseFlowIntegrityPanel } from "@/components/company/warehouse-flow-integrity-panel";
import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function num(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:2}).format(Number.isFinite(n)?n:0); }
function money(value: unknown) { const n=Number(value??0); return new Intl.NumberFormat("pl-PL",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0)+" zł"; }
function str(value: unknown,fallback="—") { return value == null || value === "" ? fallback : String(value); }

export default function WarehouseOperations({ workspaceId,data,canWrite,canApprove,pathname,query }: { workspaceId:string; data:Data; canWrite:boolean; canApprove:boolean; pathname:string; query:string }) {
  const items=(data.items??[]) as Row[], warehouses=(data.warehouses??[]) as Row[], movements=(data.movements??[]) as Row[], reservations=(data.reservations??[]) as Row[], balances=(data.balances??[]) as Row[], projects=(data.projects??[]) as Row[], summary=(data.summary??{}) as Row;
  const balanceByItem=new Map<string,number>(); balances.forEach(row=>{const id=String(row.stockItemId);balanceByItem.set(id,(balanceByItem.get(id)??0)+Number(row.quantity??0));});
  const pendingMovements=movements.filter(row=>["draft","pending","review"].includes(String(row.status))).map(row=>({...row,name:`${str(row.movement_type)} · ${str(row.document_number,"bez numeru")} · ${str(row.movement_date)}`}));
  const belowMinimum=items.filter(row=>Number(row.minimum_stock??0)>0&&(balanceByItem.get(String(row.id))??0)<Number(row.minimum_stock??0));
  const forms:FormSpec[]=[
    {title:"Dodaj magazyn",entity:"warehouse",success:"Magazyn został utworzony.",fields:[{name:"name",label:"Nazwa",required:true},{name:"location",label:"Lokalizacja"},{name:"warehouseType",label:"Typ",type:"select",options:[["central","Centralny"],["project","Budowa"],["vehicle","Mobilny / pojazd"]]}]},
    {title:"Dodaj kartotekę",entity:"stock_item",success:"Kartoteka została dodana.",fields:[{name:"name",label:"Nazwa",required:true},{name:"sku",label:"SKU"},{name:"itemType",label:"Typ",type:"select",options:[["material","Materiał"],["device","Urządzenie"],["tool","Narzędzie"]]},{name:"unit",label:"Jednostka",required:true},{name:"minimumStock",label:"Stan minimalny",type:"number"}]},
    {title:"Zarejestruj ruch",entity:"stock_movement",success:"Ruch magazynowy został zapisany.",wide:true,fields:[{name:"movementType",label:"Typ",type:"select",required:true,options:[["PZ","PZ"],["WZ","WZ"],["RW","RW"],["ZW","ZW"],["MM","MM"]]},{name:"warehouseId",label:"Magazyn",rows:warehouses,required:true},{name:"targetWarehouseId",label:"Magazyn docelowy",rows:warehouses,placeholder:"Tylko dla MM"},{name:"stockItemId",label:"Kartoteka z tej strony",rows:items,required:true},{name:"projectId",label:"Inwestycja",rows:projects,placeholder:"Puste = magazyn centralny / ruch firmowy"},{name:"quantity",label:"Ilość",type:"number",required:true},{name:"unitCost",label:"Koszt jednostkowy",type:"number"},{name:"documentNumber",label:"Numer dokumentu"},{name:"movementDate",label:"Data ruchu",type:"date"}]},
    {title:"Zarezerwuj materiał",entity:"reservation",success:"Materiał został zarezerwowany.",fields:[{name:"projectId",label:"Inwestycja",rows:projects,required:true},{name:"warehouseId",label:"Magazyn",rows:warehouses,required:true},{name:"stockItemId",label:"Kartoteka z tej strony",rows:items,required:true},{name:"quantity",label:"Ilość",type:"number",required:true},{name:"requiredAt",label:"Potrzebne na",type:"date",required:true}]},
    ...(canApprove&&pendingMovements.length?[{title:"Zatwierdź ruch magazynowy",entity:"stock_movement_approve",success:"Ruch został zatwierdzony i przeliczono stan magazynu.",fields:[{name:"movementId",label:"Ruch do zatwierdzenia",rows:pendingMovements,required:true}]} satisfies FormSpec]:[])
  ];
  const metrics=[
    {label:"Wartość zapasu",value:money(summary.stockValue),caption:`${str(summary.fifoLayers,"0")} aktywnych warstw kosztowych FIFO`},
    {label:"Magazyny",value:str(summary.warehouses,"0"),caption:"Aktywne lokalizacje"},
    {label:"Kartoteki",value:str(summary.records,"0"),caption:`${str(summary.activeItems,"0")} aktywnych`},
    {label:"Poniżej minimum",value:str(summary.belowMinimum,"0"),caption:`${str(summary.zeroStock,"0")} pozycji bez stanu`},
    {label:"Ruchy 30 dni",value:str(summary.movements30d,"0"),caption:"PZ / WZ / RW / ZW / MM"},
    {label:"Rezerwacje",value:str(summary.openReservations,"0"),caption:"Otwarte potrzeby inwestycji"},
    {label:"Inwentaryzacje",value:str(summary.openCounts,"0"),caption:"Otwarte spisy i rozbieżności"},
    {label:"Wolnorotujące",value:str(summary.slowMoving,"0"),caption:"Bez ruchu w ostatnich 90 dniach"}
  ];
  return <CompanyModuleShell workspaceId={workspaceId} data={data} canWrite={canWrite} pathname={pathname} query={query} metrics={metrics} forms={forms} rows={items} tableTitle="Kartoteki i stany" emptyLabel="Brak kartotek dla bieżącego filtra." columns={[
    {label:"Kartoteka",value:row=><strong>{str(row.name)}</strong>},
    {label:"SKU",value:row=>str(row.sku)},
    {label:"Typ",value:row=>str(row.item_type)},
    {label:"Stan",value:row=>num(balanceByItem.get(String(row.id))??0)},
    {label:"Jednostka",value:row=>str(row.unit)},
    {label:"Minimum",value:row=>str(row.minimum_stock,"0")}
  ]}>
    <WarehouseFlowIntegrityPanel workspaceId={workspaceId} movements={movements} projects={projects} canWrite={canWrite}/>
    <section className="ops-split-lists">
      <article className="ops-panel"><h3>Kontrola stanów</h3>{belowMinimum.slice(0,8).map(row=><p key={String(row.id)}><strong>{str(row.name)}</strong><br/>Stan {num(balanceByItem.get(String(row.id))??0)} / minimum {num(row.minimum_stock)} {str(row.unit,"")}</p>)}{!belowMinimum.length?<p>Brak niedoborów na bieżącej stronie.</p>:null}<p><strong>{money(summary.stockValue)}</strong> — aktualna wartość pozostałych warstw kosztowych.</p></article>
      <article className="ops-panel"><h3>Obieg i decyzje</h3><p>{pendingMovements.length} ruchów z bieżącej listy czeka na zatwierdzenie.</p>{movements.slice(0,6).map(row=><p key={String(row.id)}><strong>{str(row.movement_type)} · {str(row.document_number,"bez numeru")}</strong><br/>{str(row.movement_date)} · {str(row.status)}</p>)}</article>
    </section>
    <section className="ops-panel"><h3>Rezerwacje materiałowe</h3>{reservations.slice(0,8).map(row=><p key={String(row.id)}><strong>{num(row.quantity)} · {str(row.status)}</strong><br/>{str(row.required_at,"bez terminu")}</p>)}{!reservations.length?<p>Brak rezerwacji dla kartotek na bieżącej stronie.</p>:null}</section>
  </CompanyModuleShell>;
}
