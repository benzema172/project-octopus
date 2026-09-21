-- Performance Core 9-13
-- 1) Avoid waking the finance Multi-AI worker when no review needs analysis.
-- 2) Reuse one canonical queue predicate inside the worker.
-- 3) Add an FTS index for document body search.

create or replace function public.get_pending_finance_multi_ai_reviews(
  p_limit integer default 2,
  p_refresh boolean default false
)
returns table (
  id uuid,
  workspace_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.workspace_id, r.created_at
  from public.finance_document_reviews r
  where r.status = 'open'
    and (
      coalesce(p_refresh, false)
      or not exists (
        select 1
        from public.ai_consensus_events c
        where c.review_id = r.id
      )
    )
  order by r.created_at asc, r.id asc
  limit least(greatest(coalesce(p_limit, 2), 1), 100);
$$;

revoke all on function public.get_pending_finance_multi_ai_reviews(integer, boolean) from public;
revoke all on function public.get_pending_finance_multi_ai_reviews(integer, boolean) from anon;
revoke all on function public.get_pending_finance_multi_ai_reviews(integer, boolean) from authenticated;
grant execute on function public.get_pending_finance_multi_ai_reviews(integer, boolean) to service_role;

create or replace function public.run_unified_document_ai_queue_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  if not exists (
    select 1
    from public.get_pending_finance_multi_ai_reviews(1, false)
  ) then
    return null;
  end if;

  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name = 'octopus_background_worker_token'
  limit 1;

  if v_token is null or length(v_token) < 32 then
    return null;
  end if;

  select net.http_post(
    url := 'https://project-octopus-alpha.vercel.app/api/company/unified-document-ai/worker?limit=2',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Octopus-Background-Token', v_token
    ),
    timeout_milliseconds := 120000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.run_unified_document_ai_queue_tick() from public;
revoke all on function public.run_unified_document_ai_queue_tick() from anon;
revoke all on function public.run_unified_document_ai_queue_tick() from authenticated;
grant execute on function public.run_unified_document_ai_queue_tick() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  -- pg_cron is available in production Supabase, but the migration chain must
  -- also stay portable to CI/test Postgres instances that do not install it.
  if to_regnamespace('cron') is not null then
    begin
      execute 'select cron.unschedule($1)' using 'octopus-finance-ai-copilot-200';
    exception
      when others then null;
    end;

    execute 'select cron.schedule($1, $2, $3)'
      into v_job_id
      using
        'octopus-finance-ai-copilot-200',
        '*/10 * * * *',
        'select public.run_unified_document_ai_queue_tick();';
  end if;
end;
$cron$;

create index if not exists document_texts_search_vector_perf13_idx
  on public.document_texts
  using gin (to_tsvector('simple'::regconfig, coalesce(extracted_text, '')));
