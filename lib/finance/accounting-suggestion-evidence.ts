/** Source-grounded guard for *applying* an AI accounting suggestion to a draft.
 * Posting/final approval still requires an authorised human accountant. */
export type AccountingEvidence={
  invoiceNumber:unknown;counterpartyTaxId:unknown;lineDescription:unknown;
  lineId:unknown;accountIsActive:boolean;
  confidence:number;risk:number;threshold:number;
  tax:string;vat:number|null;manualOverride:boolean;
  reasons:unknown;
};
export function mayApplyAccountingDraftSuggestion(e:AccountingEvidence):boolean {
  const taxId=String(e.counterpartyTaxId??"").replace(/\D/g,"");
  const description=String(e.lineDescription??"").trim();
  const reasons=Array.isArray(e.reasons)?e.reasons.filter(v=>String(v).trim().length>=8):[];
  if(!e.accountIsActive||e.manualOverride||!String(e.lineId??"").trim())return false;
  if(String(e.invoiceNumber??"").trim().length<2 || taxId.length!==10 || description.length<4)return false;
  if(!Number.isFinite(e.confidence)||!Number.isFinite(e.risk)
     ||e.confidence<e.threshold||e.risk>0.10)return false;
  if(!["KUP","NKUP","neutral"].includes(e.tax) || !reasons.length)return false;
  if(e.vat!==null&&(!Number.isFinite(e.vat)||e.vat<0||e.vat>100))return false;
  // Without explicit VAT evidence do not assume full deductible input VAT.
  if(e.tax!=="neutral" && e.vat===null)return false;
  return true;
}
