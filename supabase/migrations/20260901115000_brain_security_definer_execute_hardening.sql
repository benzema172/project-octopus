revoke all on function public.apply_brain_calibration_to_classification() from public, anon, authenticated;
revoke all on function public.brain_calibrated_confidence(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.capture_ai_review_as_brain_memory() from public, anon, authenticated;
revoke all on function public.propagate_brain_confidence_to_document() from public, anon, authenticated;
revoke all on function public.propagate_brain_confidence_to_extraction() from public, anon, authenticated;
revoke all on function public.propagate_brain_confidence_to_intake() from public, anon, authenticated;
revoke all on function public.propagate_brain_confidence_to_module_proposal() from public, anon, authenticated;

grant execute on function public.apply_brain_calibration_to_classification() to service_role;
grant execute on function public.brain_calibrated_confidence(uuid, text, numeric) to service_role;
grant execute on function public.capture_ai_review_as_brain_memory() to service_role;
grant execute on function public.propagate_brain_confidence_to_document() to service_role;
grant execute on function public.propagate_brain_confidence_to_extraction() to service_role;
grant execute on function public.propagate_brain_confidence_to_intake() to service_role;
grant execute on function public.propagate_brain_confidence_to_module_proposal() to service_role;
