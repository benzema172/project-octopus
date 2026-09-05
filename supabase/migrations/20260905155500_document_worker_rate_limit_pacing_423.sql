-- Production pacing after real multi-invoice PDF acceptance test.
-- Keep the queue serialized, but avoid hammering Gemini when a model is rate-limited.
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'octopus-background-ai-queue-132'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$$;

select cron.schedule(
  'octopus-background-ai-queue-132',
  '*/5 * * * *',
  $cron$select public.run_background_ai_queue_tick();$cron$
);
