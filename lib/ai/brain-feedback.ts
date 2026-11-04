import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type BrainDecision={
 workspaceId:string;documentId:string;kind:"financial_plan"|"warehouse_intent";
 payload:{[key:string]:unknown};
};
export async function rememberBrainDecision(input:BrainDecision){
 // Idempotent for identical decisions; revisions produce their own dated evidence.
 // This event is feedback, not an AI assertion and never changes accounting or inventory.
 const digest=createHash("sha256").update(JSON.stringify(input.payload)).digest("hex").slice(0,32);
 const db=createServiceSupabaseClient();
 const {error}=await db.from("brain_learning_events").upsert({
  workspace_id:input.workspaceId,document_id:input.documentId,
  event_key:input.kind+":"+input.documentId+":"+digest,
  origin:"human_review",outcome:"accepted",
  context:{kind:input.kind,...input.payload}
 },{onConflict:"workspace_id,event_key",ignoreDuplicates:true});
 if(error)throw new Error(error.message);
}
