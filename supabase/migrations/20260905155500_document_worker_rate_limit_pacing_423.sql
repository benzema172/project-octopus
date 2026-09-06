-- Production pacing after real multi-invoice PDF acceptance test.
-- Keep the queue serialized, but avoid hammering Gemini when a model is rate-limited.
-- Production Supabase exposes pg_cron; local migration validators such as PGlite do not.
-- Keep the production schedule identical while making the migration portable.
do $$
declare
  v_jobid bigint;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is unavailable; production pacing schedule skipped in this environment.';
    return;
  end if;

  for v_jobid in execute
    'select jobid from cron.job where jobname = ''octopus-background-ai-queue-132'''
  loop
    execute format('select cron.unschedule(%s)', v_jobid);
  end loop;

  execute $schedule$
    select cron.schedule(
      'octopus-background-ai-queue-132',
      '*/5 * * * *',
      $cron$select public.run_background_ai_queue_tick();$cron$
    )
  $schedule$;
end;
$$;
