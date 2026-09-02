-- Trigger helper is internal only; client roles must never invoke it directly.
revoke all on function public.sync_template_review_state_to_template() from public;
revoke all on function public.sync_template_review_state_to_template() from anon;
revoke all on function public.sync_template_review_state_to_template() from authenticated;
