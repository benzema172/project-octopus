-- Document Intelligence 6.2
-- 1) trwałe sesje Batch Import
-- 2) bezpieczne uczenie aliasów inwestycji wyłącznie z decyzji człowieka

create table if not exists public.document_import_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  label text,
  source_module text,
  status text not null default 'uploading'
    check (status in ('uploading','processing','complete','review','error')),
  expected_files integer not null default 0 check (expected_files >= 0),
  created_by uuid references auth.users(id) on delete set null,
  upload_completed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_import_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.document_import_sessions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  relative_path text not null,
  file_name text not null,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  document_id uuid references public.documents(id) on delete set null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  upload_status text not null default 'pending'
    check (upload_status in ('pending','uploaded','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, ordinal)
);

create index if not exists idx_document_import_sessions_workspace_created
  on public.document_import_sessions(workspace_id, created_at desc);
create index if not exists idx_document_import_sessions_project_created
  on public.document_import_sessions(project_id, created_at desc)
  where project_id is not null;
create index if not exists idx_document_import_session_items_session
  on public.document_import_session_items(session_id, ordinal);
create index if not exists idx_document_import_session_items_document
  on public.document_import_session_items(document_id)
  where document_id is not null;

alter table public.document_import_sessions enable row level security;
alter table public.document_import_session_items enable row level security;

drop policy if exists "workspace members read document import sessions" on public.document_import_sessions;
create policy "workspace members read document import sessions"
on public.document_import_sessions for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = document_import_sessions.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

drop policy if exists "workspace members read document import session items" on public.document_import_session_items;
create policy "workspace members read document import session items"
on public.document_import_session_items for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = document_import_session_items.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

revoke all on table public.document_import_sessions from public, anon, authenticated;
revoke all on table public.document_import_session_items from public, anon, authenticated;
grant select on table public.document_import_sessions to authenticated;
grant select on table public.document_import_session_items to authenticated;
grant select,insert,update,delete on table public.document_import_sessions to service_role;
grant select,insert,update,delete on table public.document_import_session_items to service_role;

create or replace function private.project_alias_is_meaningful_620(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, private, pg_temp
as $$
  select length(coalesce(trim(p_value),'')) between 4 and 500
    and coalesce(trim(p_value),'') not in (
      'ogolne','ogolny','brak','brakdanych','nieprzypisane','nieznane',
      'inne','pozostale','firma','company','unknown','general'
    )
$$;

create or replace function private.learn_project_alias_from_feedback_620()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_hint text := nullif(trim(coalesce(new.project_hint,'')),'');
  v_normalized text := coalesce(
    nullif(trim(new.normalized_hint),''),
    nullif(public.normalize_project_match_alias(v_hint),'')
  );
  v_positive_project uuid;
  v_negative_project uuid;
begin
  if tg_op='UPDATE'
     and old.outcome is not distinct from new.outcome
     and old.selected_project_id is not distinct from new.selected_project_id
     and old.proposed_project_id is not distinct from new.proposed_project_id
     and old.normalized_hint is not distinct from new.normalized_hint then
    return new;
  end if;

  if not private.project_alias_is_meaningful_620(v_normalized) then
    return new;
  end if;

  if new.outcome in ('confirmed','accepted') then
    v_positive_project := coalesce(new.selected_project_id,new.proposed_project_id);
  elsif new.outcome in ('corrected','manual_assignment') then
    v_positive_project := new.selected_project_id;
    if new.proposed_project_id is distinct from new.selected_project_id then
      v_negative_project := new.proposed_project_id;
    end if;
  elsif new.outcome='rejected' then
    v_negative_project := new.proposed_project_id;
  end if;

  if v_positive_project is not null then
    insert into public.project_match_aliases(
      workspace_id,project_id,alias,normalized_alias,source,weight,
      confirmed_count,rejected_count,active,created_by,updated_at
    ) values (
      new.workspace_id,v_positive_project,left(coalesce(v_hint,v_normalized),700),left(v_normalized,500),
      'human_decision_620',0.96,1,0,true,new.decided_by,now()
    )
    on conflict(workspace_id,project_id,normalized_alias) do update set
      confirmed_count=public.project_match_aliases.confirmed_count+1,
      weight=least(1.0,greatest(public.project_match_aliases.weight,0.90)+0.02),
      active=true,
      updated_at=now();
  end if;

  if v_negative_project is not null then
    update public.project_match_aliases
       set rejected_count=rejected_count+1,
           weight=greatest(0.40,weight-0.12),
           active=case when rejected_count+1 >= greatest(2,confirmed_count+1) then false else active end,
           updated_at=now()
     where workspace_id=new.workspace_id
       and project_id=v_negative_project
       and normalized_alias=left(v_normalized,500);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_match_feedback_learning_620 on public.project_match_feedback;
create trigger trg_project_match_feedback_learning_620
after insert or update of outcome,selected_project_id,proposed_project_id,normalized_hint
on public.project_match_feedback
for each row execute function private.learn_project_alias_from_feedback_620();

create or replace function private.learn_finance_project_alias_620()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_payload jsonb := '{}'::jsonb;
  v_hint text;
  v_normalized text;
begin
  -- Uczymy się wyłącznie z jawnej decyzji człowieka, nigdy z auto_resolved.
  if new.review_type <> 'project_assignment'
     or new.status <> 'resolved'
     or new.selected_project_id is null
     or new.resolved_by is null
     or (tg_op='UPDATE' and old.status='resolved'
         and old.selected_project_id is not distinct from new.selected_project_id) then
    return new;
  end if;

  if new.business_inbox_item_id is not null then
    select case
      when jsonb_typeof(b.canonical_payload)='object' then b.canonical_payload
      else '{}'::jsonb end
    into v_payload
    from public.business_inbox_items b
    where b.id=new.business_inbox_item_id and b.workspace_id=new.workspace_id;
  end if;

  if v_payload='{}'::jsonb and new.invoice_id is not null then
    select case when jsonb_typeof(b.canonical_payload)='object' then b.canonical_payload else '{}'::jsonb end
      into v_payload
    from public.business_inbox_items b
    where b.workspace_id=new.workspace_id and b.invoice_id=new.invoice_id
    order by coalesce(b.processed_at,b.created_at) desc
    limit 1;
  end if;

  foreach v_hint in array array[
    nullif(trim(v_payload->>'projectCode'),''),
    nullif(trim(v_payload->>'projectName'),''),
    nullif(trim(v_payload->>'projectAddress'),'')
  ] loop
    if v_hint is null then continue; end if;
    v_normalized := public.normalize_project_match_alias(v_hint);
    if not private.project_alias_is_meaningful_620(v_normalized) then continue; end if;

    insert into public.project_match_aliases(
      workspace_id,project_id,alias,normalized_alias,source,weight,
      confirmed_count,rejected_count,active,created_by,updated_at
    ) values (
      new.workspace_id,new.selected_project_id,left(v_hint,700),left(v_normalized,500),
      'finance_human_decision_620',0.97,1,0,true,new.resolved_by,now()
    )
    on conflict(workspace_id,project_id,normalized_alias) do update set
      confirmed_count=public.project_match_aliases.confirmed_count+1,
      weight=least(1.0,greatest(public.project_match_aliases.weight,0.92)+0.02),
      active=true,
      updated_at=now();
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_finance_project_alias_learning_620 on public.finance_document_reviews;
create trigger trg_finance_project_alias_learning_620
after insert or update of status,selected_project_id,resolved_by
on public.finance_document_reviews
for each row execute function private.learn_finance_project_alias_620();

revoke all on function private.project_alias_is_meaningful_620(text) from public,anon,authenticated;
revoke all on function private.learn_project_alias_from_feedback_620() from public,anon,authenticated;
revoke all on function private.learn_finance_project_alias_620() from public,anon,authenticated;
