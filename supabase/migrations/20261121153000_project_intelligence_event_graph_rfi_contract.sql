
-- Incremental, evidence-linked project intelligence. No appearance/UI changes.
create table if not exists public.project_intelligence_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete cascade,
  source_version_id uuid not null references public.document_versions(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation text not null,
  edge_key text not null,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  source_locator jsonb not null default '{}'::jsonb,
  source_quote text,
  status text not null default 'proposed' check (status in ('proposed','verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, edge_key)
);
create index if not exists project_intelligence_edges_project_idx
  on public.project_intelligence_edges(workspace_id,project_id,source_version_id);
create index if not exists project_intelligence_edges_source_document_idx
  on public.project_intelligence_edges(source_document_id);

create table if not exists public.project_intelligence_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete cascade,
  source_version_id uuid not null references public.document_versions(id) on delete cascade,
  finding_key text not null,
  kind text not null check (kind in ('revision_clash','rfi_draft','contract_risk')),
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  description text not null,
  draft_text text,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,finding_key)
);
create index if not exists project_intelligence_findings_pending_idx
  on public.project_intelligence_findings(workspace_id,project_id,created_at desc)
  where status='pending';
create index if not exists project_intelligence_findings_project_idx
  on public.project_intelligence_findings(project_id);
create index if not exists project_intelligence_findings_source_document_idx
  on public.project_intelligence_findings(source_document_id);
create index if not exists project_intelligence_findings_source_version_idx
  on public.project_intelligence_findings(source_version_id);

create table if not exists public.project_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  status text not null default 'processed' check(status in ('processed','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,event_key)
);
create index if not exists project_intelligence_events_project_idx
  on public.project_intelligence_events(workspace_id,project_id,created_at desc);
create index if not exists project_intelligence_events_version_idx
  on public.project_intelligence_events(document_version_id);

-- All intelligence is service-owned; never expose privileged writes through PostgREST.
alter table public.project_intelligence_edges enable row level security;
alter table public.project_intelligence_findings enable row level security;
alter table public.project_intelligence_events enable row level security;
revoke all on public.project_intelligence_edges from public,anon,authenticated;
revoke all on public.project_intelligence_findings from public,anon,authenticated;
revoke all on public.project_intelligence_events from public,anon,authenticated;

-- Recompute only ONE document version, never the whole workspace/project.
-- All conclusions are proposed and source-cited; no financial or RFI approval.
create or replace function public.refresh_project_intelligence_for_version(
  p_workspace_id uuid, p_version_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public,pg_temp
as $octopus_intelligence$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_links integer:=0;
  v_findings integer:=0;
begin
  select v.* into v_version from public.document_versions v
    join public.documents d on d.id=v.document_id
    where v.id=p_version_id and d.workspace_id=p_workspace_id;
  if not found then raise exception 'Version not found in workspace'; end if;
  select * into v_document from public.documents
    where id=v_version.document_id and workspace_id=p_workspace_id;
  if v_document.deleted_at is not null or v_document.project_id is null then
    return jsonb_build_object('skipped','no_active_project');
  end if;

  -- Documents -> native project modules, with actual source quotes and locators.
  insert into public.project_intelligence_edges(
    workspace_id,project_id,source_document_id,source_version_id,
    source_type,source_id,target_type,target_id,relation,edge_key,
    confidence,source_locator,source_quote,status,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'document_version',v_version.id,
    coalesce(nullif(p.published_entity_type,''),'module_proposal'),
    coalesce(p.published_entity_id,p.id),
    'source_supports_module',
    'proposal:'||p.id::text,
    least(1,greatest(0,coalesce(p.confidence,0))),
    coalesce(p.source_locator,'{}'::jsonb),
    left(p.source_quote,2000),
    case when p.status='published' then 'verified' else 'proposed' end,now()
  from public.document_module_proposals p
  where p.workspace_id=p_workspace_id and p.document_id=v_document.id
    and p.document_version_id=v_version.id
    and p.project_id=v_document.project_id
    and p.status in ('published','approved','proposed')
  on conflict(workspace_id,edge_key) do update set
    target_type=excluded.target_type,target_id=excluded.target_id,
    status=excluded.status,confidence=excluded.confidence,
    source_locator=excluded.source_locator,source_quote=excluded.source_quote,
    updated_at=now();
  get diagnostics v_links=row_count;

  -- Canonical financial truth -> the exact source document.
  insert into public.project_intelligence_edges(
    workspace_id,project_id,source_document_id,source_version_id,
    source_type,source_id,target_type,target_id,relation,edge_key,
    confidence,status,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'document_version',v_version.id,'invoice',i.id,
    'document_records_invoice','invoice:'||v_version.id::text||':'||i.id::text,
    1,'verified',now()
  from public.invoices i where i.workspace_id=p_workspace_id and i.document_id=v_document.id
  on conflict(workspace_id,edge_key) do update set updated_at=now();

  -- Physical stock ledger -> the same document. No duplicate inventory creation.
  insert into public.project_intelligence_edges(
    workspace_id,project_id,source_document_id,source_version_id,
    source_type,source_id,target_type,target_id,relation,edge_key,
    confidence,status,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'document_version',v_version.id,'stock_movement',m.id,
    'document_records_stock','stock:'||v_version.id::text||':'||m.id::text,
    1,'verified',now()
  from public.stock_movements m
  where m.workspace_id=p_workspace_id and m.source_document_id=v_document.id
  on conflict(workspace_id,edge_key) do update set updated_at=now();

  -- Revision chain: original -> revised version, only if backed by an impact row.
  insert into public.project_intelligence_edges(
    workspace_id,project_id,source_document_id,source_version_id,
    source_type,source_id,target_type,target_id,relation,edge_key,
    confidence,source_locator,source_quote,status,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'document_version',ci.from_version_id,
    'document_version',ci.to_version_id,'revision_impact',
    'revision:'||ci.id::text,
    least(1,greatest(0,coalesce(ci.confidence,0))),
    jsonb_build_object('impact_id',ci.id,'risk_level',ci.risk_level),
    left(ci.summary,2000),'proposed',now()
  from public.document_change_impacts ci
  where ci.document_id=v_document.id and ci.to_version_id=v_version.id
    and ci.workspace_id=p_workspace_id and ci.project_id=v_document.project_id
    and ci.from_version_id is not null
  on conflict(workspace_id,edge_key) do update set
    confidence=excluded.confidence,source_locator=excluded.source_locator,
    source_quote=excluded.source_quote,updated_at=now();

  -- A factual change warning, without inventing a clash or claiming compliance failure.
  insert into public.project_intelligence_findings(
    workspace_id,project_id,source_document_id,source_version_id,
    finding_key,kind,severity,title,description,evidence,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'change:'||ci.id::text,'revision_clash',
    case when ci.risk_level in ('critical','high','medium','low') then ci.risk_level else 'medium' end,
    'Zmiana dokumentacji: '||left(coalesce(nullif(ci.summary,''),'wymagana kontrola'),180),
    'Potencjalny konflikt między rewizjami. Wymagana weryfikacja na podstawie dokumentów źródłowych.',
    jsonb_build_object('impact_id',ci.id,'from_version_id',ci.from_version_id,
      'to_version_id',ci.to_version_id,'summary',ci.summary,
      'source_evidence',coalesce(ci.evidence,'[]'::jsonb)),now()
  from public.document_change_impacts ci
  where ci.workspace_id=p_workspace_id and ci.project_id=v_document.project_id
    and ci.document_id=v_document.id and ci.to_version_id=v_version.id
    and ci.status not in ('rejected')
  on conflict(workspace_id,finding_key) do update set
    title=excluded.title,description=excluded.description,evidence=excluded.evidence,
    updated_at=now()
  where public.project_intelligence_findings.status='pending';
  get diagnostics v_findings=row_count;

  -- RFI is only a DRAFT; a human must verify, approve and send it externally.
  insert into public.project_intelligence_findings(
    workspace_id,project_id,source_document_id,source_version_id,
    finding_key,kind,severity,title,description,draft_text,evidence,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'rfi:'||ci.id::text,'rfi_draft',
    case when ci.risk_level='critical' then 'critical' else 'high' end,
    'Projekt RFI dotyczący zmiany dokumentacji',
    'Szkic zapytania technicznego oparty na wykrytej zmianie; nic nie zostało wysłane.',
    'Prosimy o potwierdzenie, czy poniższa zmiana wpływa na zakres, ilości, harmonogram lub odbiór robót: '
       ||coalesce(nullif(ci.summary,''),'[opis zmiany do uzupełnienia]')
       ||'. Prosimy o wskazanie obowiązującej rewizji i sposobu dalszego postępowania.',
    jsonb_build_object('impact_id',ci.id,'from_version_id',ci.from_version_id,
      'to_version_id',ci.to_version_id,'source_evidence',coalesce(ci.evidence,'[]'::jsonb)),now()
  from public.document_change_impacts ci
  where ci.workspace_id=p_workspace_id and ci.project_id=v_document.project_id
    and ci.document_id=v_document.id and ci.to_version_id=v_version.id
    and ci.risk_level in ('high','critical') and ci.status not in ('approved','rejected')
  on conflict(workspace_id,finding_key) do update set
    draft_text=excluded.draft_text,evidence=excluded.evidence,updated_at=now()
  where public.project_intelligence_findings.status='pending';

  -- Contract risk must have a *real contract source* and high-risk change evidence.
  insert into public.project_intelligence_findings(
    workspace_id,project_id,source_document_id,source_version_id,
    finding_key,kind,severity,title,description,evidence,updated_at
  )
  select p_workspace_id,v_document.project_id,v_document.id,v_version.id,
    'contract:'||ci.id::text,'contract_risk',
    case when ci.risk_level='critical' then 'critical' else 'high' end,
    'Możliwe ryzyko kontraktowe po zmianie dokumentu',
    'Sprawdź wpływ zatwierdzonej rewizji na zobowiązania, harmonogram i rozliczenia. Nie jest to stwierdzenie naruszenia umowy.',
    jsonb_build_object('impact_id',ci.id,'summary',ci.summary,
      'source_evidence',coalesce(ci.evidence,'[]'::jsonb),
      'contract_document_id',v_document.id),now()
  from public.document_change_impacts ci
  where ci.workspace_id=p_workspace_id and ci.project_id=v_document.project_id
    and ci.document_id=v_document.id and ci.to_version_id=v_version.id
    and lower(coalesce(v_document.category,'')) in ('contract','agreement','umowa')
    and ci.risk_level in ('high','critical') and ci.status not in ('rejected')
  on conflict(workspace_id,finding_key) do update set
    evidence=excluded.evidence,updated_at=now()
  where public.project_intelligence_findings.status='pending';

  -- Idempotent event receipt; a repeated route never multiplies documents or alerts.
  insert into public.project_intelligence_events(
    workspace_id,project_id,document_version_id,event_key,event_type,status,details,updated_at
  ) values (
    p_workspace_id,v_document.project_id,v_version.id,
    'route:'||v_version.id::text,'document_route_committed','processed',
    jsonb_build_object('source_document_id',v_document.id,'graph_writes',v_links,
      'change_writes',v_findings),now()
  )
  on conflict(workspace_id,event_key) do update set
    details=excluded.details,status='processed',updated_at=now();

  return jsonb_build_object('processed',true,'source_version_id',v_version.id,
    'graph_writes',v_links,'change_writes',v_findings);
end;
$octopus_intelligence$;

revoke all on function public.refresh_project_intelligence_for_version(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.refresh_project_intelligence_for_version(uuid,uuid)
  to service_role;

-- Event-driven refresh, scoped to the document whose routing actually changed.
create or replace function public.trg_refresh_project_intelligence_route()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $octopus_intelligence_trigger$
begin
  if new.stage='route' and new.status in ('complete','review') then
    perform public.refresh_project_intelligence_for_version(new.workspace_id,new.document_version_id);
  end if;
  return new;
end;
$octopus_intelligence_trigger$;
revoke all on function public.trg_refresh_project_intelligence_route()
  from public,anon,authenticated;
drop trigger if exists project_intelligence_route_event on public.document_pipeline_stages;
create trigger project_intelligence_route_event
  after insert or update of status on public.document_pipeline_stages
  for each row execute function public.trg_refresh_project_intelligence_route();

-- Incremental finance/warehouse corrections: update graph only for the source version.
create or replace function public.trg_refresh_project_intelligence_source()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $octopus_intelligence_source$
declare v_version uuid; v_workspace uuid; v_document uuid;
begin
  if tg_table_name='stock_movements' then
    v_document := new.source_document_id;
  else
    v_document := new.document_id;
  end if;
  if v_document is null then return new; end if;
  select d.current_version_id,d.workspace_id into v_version,v_workspace
  from public.documents d where d.id=v_document;
  if v_version is not null and v_workspace is not null then
    perform public.refresh_project_intelligence_for_version(v_workspace,v_version);
  end if;
  return new;
end;
$octopus_intelligence_source$;
revoke all on function public.trg_refresh_project_intelligence_source()
  from public,anon,authenticated;
drop trigger if exists project_intelligence_invoice_event on public.invoices;
create trigger project_intelligence_invoice_event
  after insert or update of document_id on public.invoices
  for each row execute function public.trg_refresh_project_intelligence_source();
drop trigger if exists project_intelligence_warehouse_event on public.stock_movements;
create trigger project_intelligence_warehouse_event
  after insert or update of source_document_id on public.stock_movements
  for each row execute function public.trg_refresh_project_intelligence_source();

-- Proposals and detected revisions may be persisted after the route stage;
-- listen for those native events too instead of requiring a manual reprocess.
create or replace function public.trg_refresh_project_intelligence_proposal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $octopus_intelligence_proposal$
begin
  if new.document_version_id is not null and new.workspace_id is not null then
    perform public.refresh_project_intelligence_for_version(new.workspace_id,new.document_version_id);
  end if;
  return new;
end;
$octopus_intelligence_proposal$;
revoke all on function public.trg_refresh_project_intelligence_proposal()
  from public,anon,authenticated;
drop trigger if exists project_intelligence_proposal_event on public.document_module_proposals;
create trigger project_intelligence_proposal_event
  after insert or update of status,published_entity_id,published_entity_type on public.document_module_proposals
  for each row execute function public.trg_refresh_project_intelligence_proposal();

create or replace function public.trg_refresh_project_intelligence_impact()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $octopus_intelligence_impact$
begin
  if new.to_version_id is not null and new.workspace_id is not null then
    perform public.refresh_project_intelligence_for_version(new.workspace_id,new.to_version_id);
  end if;
  return new;
end;
$octopus_intelligence_impact$;
revoke all on function public.trg_refresh_project_intelligence_impact()
  from public,anon,authenticated;
drop trigger if exists project_intelligence_change_event on public.document_change_impacts;
create trigger project_intelligence_change_event
  after insert or update of status,risk_level,summary,evidence on public.document_change_impacts
  for each row execute function public.trg_refresh_project_intelligence_impact();

-- The review decision and audit log must commit or fail together.
create or replace function public.trg_project_intelligence_review_audit()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $octopus_intelligence_review_audit$
begin
  if old.status='pending' and new.status in ('accepted','dismissed') then
    if new.reviewed_by is null then
      raise exception 'The reviewer identity is required';
    end if;
    insert into public.audit_events(
      workspace_id,project_id,actor_id,actor_type,event_type,entity_type,
      entity_id,before_value,after_value
    ) values (
      new.workspace_id,new.project_id,new.reviewed_by,'user',
      'project.intelligence_finding_reviewed','project_intelligence_finding',
      new.id::text,
      jsonb_build_object('kind',old.kind,'status',old.status),
      jsonb_build_object('kind',new.kind,'status',new.status,'sentExternally',false)
    );
  end if;
  return new;
end;
$octopus_intelligence_review_audit$;
revoke all on function public.trg_project_intelligence_review_audit()
  from public,anon,authenticated;
drop trigger if exists project_intelligence_review_audit on public.project_intelligence_findings;
create trigger project_intelligence_review_audit
  after update of status on public.project_intelligence_findings
  for each row execute function public.trg_project_intelligence_review_audit();
