-- Accounting AI 7.0
-- Professional pre-accounting / dekretacja layer for Finance Control Tower.

alter table public.accounting_accounts
  add column if not exists parent_account_id uuid references public.accounting_accounts(id) on delete set null,
  add column if not exists level_no integer not null default 1,
  add column if not exists is_synthetic boolean not null default false,
  add column if not exists jpk_s12_1 text,
  add column if not exists jpk_s12_2 text,
  add column if not exists jpk_s12_3 text,
  add column if not exists tax_default text not null default 'review',
  add column if not exists vat_policy text not null default 'review',
  add column if not exists vat_deduction_pct numeric(5,2),
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists source text not null default 'system',
  add column if not exists updated_at timestamptz not null default now();

alter table public.accounting_accounts
  drop constraint if exists accounting_accounts_tax_default_check,
  add constraint accounting_accounts_tax_default_check check (tax_default in ('KUP','NKUP','neutral','review')),
  drop constraint if exists accounting_accounts_vat_policy_check,
  add constraint accounting_accounts_vat_policy_check check (vat_policy in ('full','partial','none','review')),
  drop constraint if exists accounting_accounts_vat_deduction_pct_check,
  add constraint accounting_accounts_vat_deduction_pct_check check (vat_deduction_pct is null or (vat_deduction_pct between 0 and 100));

alter table public.accounting_rules
  add column if not exists keywords text[] not null default '{}'::text[],
  add column if not exists tax_treatment text,
  add column if not exists vat_code text,
  add column if not exists vat_deduction_pct numeric(5,2),
  add column if not exists min_confidence numeric(5,4) not null default 0.90,
  add column if not exists accountant_rule boolean not null default false,
  add column if not exists notes text;

alter table public.accounting_rules
  drop constraint if exists accounting_rules_tax_treatment_check,
  add constraint accounting_rules_tax_treatment_check check (tax_treatment is null or tax_treatment in ('KUP','NKUP','neutral','review')),
  drop constraint if exists accounting_rules_vat_deduction_pct_check,
  add constraint accounting_rules_vat_deduction_pct_check check (vat_deduction_pct is null or (vat_deduction_pct between 0 and 100)),
  drop constraint if exists accounting_rules_min_confidence_check,
  add constraint accounting_rules_min_confidence_check check (min_confidence between 0 and 1);

alter table public.accounting_entries
  add column if not exists accounting_period date,
  add column if not exists tax_period date,
  add column if not exists ai_confidence numeric(5,4),
  add column if not exists ai_risk numeric(5,4),
  add column if not exists ai_mode text,
  add column if not exists ai_summary text,
  add column if not exists needs_review boolean not null default true,
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.accounting_entries
  drop constraint if exists accounting_entries_ai_confidence_check,
  add constraint accounting_entries_ai_confidence_check check (ai_confidence is null or ai_confidence between 0 and 1),
  drop constraint if exists accounting_entries_ai_risk_check,
  add constraint accounting_entries_ai_risk_check check (ai_risk is null or ai_risk between 0 and 1);

alter table public.accounting_entry_lines
  add column if not exists tax_treatment text not null default 'review',
  add column if not exists vat_deduction_pct numeric(5,2),
  add column if not exists source_rule_id uuid references public.accounting_rules(id) on delete set null,
  add column if not exists ai_confidence numeric(5,4),
  add column if not exists ai_reason text,
  add column if not exists ai_evidence jsonb not null default '{}'::jsonb,
  add column if not exists manual_override boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.accounting_entry_lines
  drop constraint if exists accounting_entry_lines_tax_treatment_check,
  add constraint accounting_entry_lines_tax_treatment_check check (tax_treatment in ('KUP','NKUP','neutral','review')),
  drop constraint if exists accounting_entry_lines_vat_deduction_pct_check,
  add constraint accounting_entry_lines_vat_deduction_pct_check check (vat_deduction_pct is null or (vat_deduction_pct between 0 and 100)),
  drop constraint if exists accounting_entry_lines_ai_confidence_check,
  add constraint accounting_entry_lines_ai_confidence_check check (ai_confidence is null or ai_confidence between 0 and 1);

create table if not exists public.accounting_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  proposal_confidence_threshold numeric(5,4) not null default 0.92 check (proposal_confidence_threshold between 0 and 1),
  ai_auto_apply_threshold numeric(5,4) not null default 0.97 check (ai_auto_apply_threshold between 0 and 1),
  allow_ai_auto_approval boolean not null default false,
  require_jpk_markers boolean not null default false,
  default_vat_deduction_pct numeric(5,2) not null default 100 check (default_vat_deduction_pct between 0 and 100),
  fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_decision_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  normalized_pattern text not null,
  sample_description text,
  line_type text,
  expense_category text,
  allocation_scope text,
  account_id uuid not null references public.accounting_accounts(id) on delete cascade,
  tax_treatment text not null default 'review' check (tax_treatment in ('KUP','NKUP','neutral','review')),
  vat_deduction_pct numeric(5,2) check (vat_deduction_pct is null or (vat_deduction_pct between 0 and 100)),
  confirmations integer not null default 0,
  rejections integer not null default 0,
  weight numeric(5,4) not null default 0.80 check (weight between 0 and 1),
  active boolean not null default true,
  last_confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,counterparty_id,normalized_pattern,account_id)
);

create table if not exists public.accounting_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_id uuid not null references public.accounting_entries(id) on delete cascade,
  line_id uuid references public.accounting_entry_lines(id) on delete cascade,
  suggested_account_id uuid references public.accounting_accounts(id) on delete set null,
  suggested_tax_treatment text check (suggested_tax_treatment is null or suggested_tax_treatment in ('KUP','NKUP','neutral','review')),
  suggested_vat_deduction_pct numeric(5,2) check (suggested_vat_deduction_pct is null or (suggested_vat_deduction_pct between 0 and 100)),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  risk_score numeric(5,4) not null default 0 check (risk_score between 0 and 1),
  summary text,
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  model text,
  status text not null default 'active' check (status in ('active','applied','rejected','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_export_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  adapter text not null default 'generic_csv' check (adapter in ('generic_csv','octopus_json','custom_csv')),
  delimiter text not null default ';',
  mapping jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,name)
);

create table if not exists public.accounting_plan_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text not null,
  format text not null,
  rows_total integer not null default 0,
  rows_created integer not null default 0,
  rows_updated integer not null default 0,
  rows_rejected integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now()
);

create index if not exists idx_accounting_accounts_parent_700 on public.accounting_accounts(parent_account_id);
create index if not exists idx_accounting_entry_lines_rule_700 on public.accounting_entry_lines(source_rule_id);
create index if not exists idx_accounting_settings_updated_by_700 on public.accounting_settings(updated_by);
create index if not exists idx_accounting_memory_workspace_700 on public.accounting_decision_memory(workspace_id,active,weight desc);
create index if not exists idx_accounting_memory_counterparty_700 on public.accounting_decision_memory(counterparty_id);
create index if not exists idx_accounting_memory_account_700 on public.accounting_decision_memory(account_id);
create index if not exists idx_accounting_memory_user_700 on public.accounting_decision_memory(last_confirmed_by);
create index if not exists idx_accounting_ai_workspace_entry_700 on public.accounting_ai_suggestions(workspace_id,entry_id,status);
create index if not exists idx_accounting_ai_line_700 on public.accounting_ai_suggestions(line_id);
create index if not exists idx_accounting_ai_account_700 on public.accounting_ai_suggestions(suggested_account_id);
create index if not exists idx_accounting_export_profiles_workspace_700 on public.accounting_export_profiles(workspace_id,active);
create index if not exists idx_accounting_export_profiles_created_by_700 on public.accounting_export_profiles(created_by);
create index if not exists idx_accounting_plan_imports_workspace_700 on public.accounting_plan_imports(workspace_id,imported_at desc);
create index if not exists idx_accounting_plan_imports_user_700 on public.accounting_plan_imports(imported_by);

alter table public.accounting_settings enable row level security;
alter table public.accounting_decision_memory enable row level security;
alter table public.accounting_ai_suggestions enable row level security;
alter table public.accounting_export_profiles enable row level security;
alter table public.accounting_plan_imports enable row level security;

drop policy if exists "finance read accounting settings 700" on public.accounting_settings;
create policy "finance read accounting settings 700" on public.accounting_settings for select to authenticated
using (private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance read accounting memory 700" on public.accounting_decision_memory;
create policy "finance read accounting memory 700" on public.accounting_decision_memory for select to authenticated
using (private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance read accounting ai 700" on public.accounting_ai_suggestions;
create policy "finance read accounting ai 700" on public.accounting_ai_suggestions for select to authenticated
using (private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance read accounting exports 700" on public.accounting_export_profiles;
create policy "finance read accounting exports 700" on public.accounting_export_profiles for select to authenticated
using (private.has_domain_access(workspace_id,'finance','read',null::uuid));
drop policy if exists "finance read accounting imports 700" on public.accounting_plan_imports;
create policy "finance read accounting imports 700" on public.accounting_plan_imports for select to authenticated
using (private.has_domain_access(workspace_id,'finance','read',null::uuid));

revoke all on public.accounting_settings,public.accounting_decision_memory,public.accounting_ai_suggestions,public.accounting_export_profiles,public.accounting_plan_imports from public,anon,authenticated;
grant select on public.accounting_settings,public.accounting_decision_memory,public.accounting_ai_suggestions,public.accounting_export_profiles,public.accounting_plan_imports to authenticated;
grant select,insert,update,delete on public.accounting_settings,public.accounting_decision_memory,public.accounting_ai_suggestions,public.accounting_export_profiles,public.accounting_plan_imports to service_role;

create or replace function public.normalize_accounting_pattern_700(p_value text)
returns text language sql immutable parallel safe set search_path=public,pg_temp as $$
  select left(regexp_replace(lower(trim(coalesce(p_value,''))),'[^a-z0-9ąćęłńóśźż]+','','g'),180)
$$;
revoke all on function public.normalize_accounting_pattern_700(text) from public,anon,authenticated;
grant execute on function public.normalize_accounting_pattern_700(text) to service_role;

create or replace function public.ensure_accounting_settings_700(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.accounting_settings(workspace_id) values(p_workspace_id)
  on conflict(workspace_id) do nothing;
  insert into public.accounting_export_profiles(workspace_id,name,adapter,is_default)
  values(p_workspace_id,'Octopus CSV','generic_csv',true)
  on conflict(workspace_id,name) do nothing;
end $$;
revoke all on function public.ensure_accounting_settings_700(uuid) from public,anon,authenticated;
grant execute on function public.ensure_accounting_settings_700(uuid) to service_role;

create or replace function public.resolve_accounting_rule(p_workspace_id uuid,p_direction text,p_line_type text,p_expense_category text,p_allocation_scope text,p_counterparty_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_rule public.accounting_rules%rowtype;
begin
  select * into v_rule from public.accounting_rules r
  where r.workspace_id=p_workspace_id and r.active=true
    and r.direction in (p_direction,'both')
    and (r.line_type is null or r.line_type=p_line_type)
    and (r.expense_category is null or r.expense_category=coalesce(p_expense_category,''))
    and (r.allocation_scope is null or r.allocation_scope=coalesce(p_allocation_scope,'unassigned'))
    and (r.counterparty_id is null or r.counterparty_id=p_counterparty_id)
  order by r.priority desc,
    (r.counterparty_id is not null)::int desc,
    (r.expense_category is not null)::int desc,
    (r.allocation_scope is not null)::int desc,
    (r.line_type is not null)::int desc,
    r.created_at
  limit 1;

  if not found then
    return jsonb_build_object(
      'source','fallback','priority',0,'ruleId',null,
      'debitAccountCode',case when p_direction='purchase' then case when p_line_type='material' then '401-02' when p_line_type='service' then '402-01' else '409-01' end else null end,
      'creditAccountCode',case when p_direction='sale' then '701-01' else null end,
      'defaultCostCode',null,'taxTreatment','review','vatCode',null,'vatDeductionPct',null,'minConfidence',0.65,'counterpartySpecific',false
    );
  end if;
  return jsonb_build_object(
    'source','rule','priority',v_rule.priority,'ruleId',v_rule.id,
    'debitAccountCode',v_rule.debit_account_code,'creditAccountCode',v_rule.credit_account_code,
    'defaultCostCode',v_rule.default_cost_code,'taxTreatment',v_rule.tax_treatment,'vatCode',v_rule.vat_code,
    'vatDeductionPct',v_rule.vat_deduction_pct,'minConfidence',v_rule.min_confidence,
    'counterpartySpecific',v_rule.counterparty_id is not null,'accountantRule',v_rule.accountant_rule,'ruleName',v_rule.name
  );
end $$;
revoke all on function public.resolve_accounting_rule(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_accounting_rule(uuid,text,text,text,text,uuid) to service_role;

create or replace function public.accounting_memory_suggestion_700(
  p_workspace_id uuid,p_counterparty_id uuid,p_description text,p_line_type text,p_expense_category text,p_allocation_scope text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_pattern text:=public.normalize_accounting_pattern_700(p_description); v_row record;
begin
  if p_counterparty_id is null or length(v_pattern)<4 then return null; end if;
  select m.*,a.code account_code,a.name account_name into v_row
  from public.accounting_decision_memory m
  join public.accounting_accounts a on a.id=m.account_id and a.workspace_id=m.workspace_id and a.active=true
  where m.workspace_id=p_workspace_id and m.counterparty_id=p_counterparty_id and m.active=true
    and m.normalized_pattern=v_pattern
    and (m.line_type is null or m.line_type=coalesce(p_line_type,''))
    and (m.expense_category is null or m.expense_category=coalesce(p_expense_category,''))
    and (m.allocation_scope is null or m.allocation_scope=coalesce(p_allocation_scope,'unassigned'))
    and m.confirmations>=1
  order by m.weight desc,m.confirmations desc,m.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('memoryId',v_row.id,'accountId',v_row.account_id,'accountCode',v_row.account_code,'accountName',v_row.account_name,
    'taxTreatment',v_row.tax_treatment,'vatDeductionPct',v_row.vat_deduction_pct,
    'confidence',least(0.995,v_row.weight+least(0.08,v_row.confirmations*0.01)),
    'reason',format('Historia zatwierdzonych dekretów kontrahenta: %s potwierdzeń, %s korekt.',v_row.confirmations,v_row.rejections));
end $$;
revoke all on function public.accounting_memory_suggestion_700(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accounting_memory_suggestion_700(uuid,uuid,text,text,text,text) to service_role;

create or replace function public.approve_accounting_entry_700(p_workspace_id uuid,p_entry_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.accounting_entries%rowtype; v_counterparty uuid; v_line record; v_pattern text; v_debit numeric; v_credit numeric;
begin
  select * into v_entry from public.accounting_entries where id=p_entry_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Dekret nie należy do firmy.'; end if;
  if v_entry.exported_at is not null then raise exception 'Wyeksportowanego dekretu nie można ponownie zatwierdzić.'; end if;

  select coalesce(sum(amount) filter(where side='debit'),0),coalesce(sum(amount) filter(where side='credit'),0)
  into v_debit,v_credit from public.accounting_entry_lines where entry_id=v_entry.id and workspace_id=p_workspace_id;
  if abs(v_debit-v_credit)>0.01 or v_debit<=0 then raise exception 'Dekret nie bilansuje się Wn/Ma.'; end if;
  if exists(select 1 from public.accounting_entry_lines where entry_id=v_entry.id and workspace_id=p_workspace_id and tax_treatment='review') then
    raise exception 'Dekret zawiera pozycje z nierozstrzygniętym KUP/NKUP. Uzupełnij je przed zatwierdzeniem.';
  end if;
  if exists(select 1 from public.accounting_settings s where s.workspace_id=p_workspace_id and s.require_jpk_markers=true)
     and exists(
       select 1 from public.accounting_entry_lines l
       join public.accounting_accounts a on a.id=l.account_id
       where l.entry_id=v_entry.id and l.workspace_id=p_workspace_id and nullif(trim(coalesce(a.jpk_s12_1,'')),'') is null
     ) then
    raise exception 'Polityka firmy wymaga znacznika JPK S_12_1 na każdym koncie użytym w dekrecie.';
  end if;

  update public.accounting_entries set status='approved',approved_by=p_actor_id,approved_at=now(),locked_at=now(),needs_review=false,updated_at=now()
  where id=v_entry.id;

  if v_entry.invoice_id is not null then
    select counterparty_id into v_counterparty from public.invoices where id=v_entry.invoice_id and workspace_id=p_workspace_id;
  end if;

  if v_counterparty is not null then
    for v_line in
      select ael.*,il.description line_description,il.line_type,il.expense_category,fa.allocation_scope
      from public.accounting_entry_lines ael
      left join public.invoice_lines il on il.id=ael.invoice_line_id
      left join lateral (
        select allocation_scope from public.financial_allocations x
        where x.workspace_id=p_workspace_id and x.source_type='invoice' and x.source_line_id=ael.invoice_line_id
          and coalesce(x.status,'') not in ('rejected','cancelled')
        order by x.created_at limit 1
      ) fa on true
      where ael.entry_id=v_entry.id and ael.workspace_id=p_workspace_id and ael.side='debit' and ael.invoice_line_id is not null
    loop
      v_pattern:=public.normalize_accounting_pattern_700(coalesce(v_line.line_description,v_line.description));
      if length(v_pattern)>=4 then
        insert into public.accounting_decision_memory(
          workspace_id,counterparty_id,normalized_pattern,sample_description,line_type,expense_category,allocation_scope,account_id,tax_treatment,vat_deduction_pct,
          confirmations,rejections,weight,active,last_confirmed_by,updated_at
        ) values(
          p_workspace_id,v_counterparty,v_pattern,left(coalesce(v_line.line_description,v_line.description),500),v_line.line_type,v_line.expense_category,v_line.allocation_scope,v_line.account_id,
          v_line.tax_treatment,v_line.vat_deduction_pct,case when v_line.manual_override then 2 else 1 end,0,
          case when v_line.manual_override then 0.98 else 0.90 end,true,p_actor_id,now()
        )
        on conflict(workspace_id,counterparty_id,normalized_pattern,account_id) do update set
          confirmations=public.accounting_decision_memory.confirmations + case when excluded.weight>=0.98 then 2 else 1 end,
          sample_description=coalesce(excluded.sample_description,public.accounting_decision_memory.sample_description),
          tax_treatment=excluded.tax_treatment,vat_deduction_pct=excluded.vat_deduction_pct,
          weight=least(1.0,greatest(public.accounting_decision_memory.weight,excluded.weight)+0.01),
          active=true,last_confirmed_by=p_actor_id,updated_at=now();
      end if;
    end loop;
  end if;

  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,v_entry.project_id,p_actor_id,'user','accounting.entry_approved_700','accounting_entry',v_entry.id::text,
    jsonb_build_object('totalDebit',v_debit,'totalCredit',v_credit,'learned',v_counterparty is not null));
  return jsonb_build_object('entryId',v_entry.id,'status','approved','totalDebit',v_debit,'totalCredit',v_credit);
end $$;
revoke all on function public.approve_accounting_entry_700(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_accounting_entry_700(uuid,uuid,uuid) to service_role;

-- Po imporcie plan księgowej jest nadrzędny. Systemowe konta/reguły są wyłącznie bootstrapem
-- i nigdy nie nadpisują istniejącego planu ani schematów użytkownika.
create or replace function public.ensure_default_accounting_accounts(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.accounting_accounts(workspace_id,code,name,account_type,source) values
    (p_workspace_id,'201-00','Rozrachunki z odbiorcami','receivable','system'),
    (p_workspace_id,'202-00','Rozrachunki z dostawcami','payable','system'),
    (p_workspace_id,'221-01','VAT należny','tax','system'),
    (p_workspace_id,'223-01','VAT naliczony','tax','system'),
    (p_workspace_id,'310-01','Materiały i towary w magazynie','asset','system'),
    (p_workspace_id,'401-02','Materiały bezpośrednie inwestycji','expense','system'),
    (p_workspace_id,'402-01','Usługi obce','expense','system'),
    (p_workspace_id,'403-01','Paliwo i koszty floty','expense','system'),
    (p_workspace_id,'405-01','Narzędzia i wyposażenie','expense','system'),
    (p_workspace_id,'409-01','Koszty ogólne i nierozpoznane','expense','system'),
    (p_workspace_id,'701-01','Przychody ze sprzedaży usług','revenue','system')
  on conflict(workspace_id,code) do nothing;
end $$;
revoke all on function public.ensure_default_accounting_accounts(uuid) from public,anon,authenticated;
grant execute on function public.ensure_default_accounting_accounts(uuid) to service_role;

create or replace function public.ensure_default_accounting_rules(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.ensure_default_accounting_accounts(p_workspace_id);
  insert into public.accounting_rules(
    workspace_id,name,priority,direction,line_type,expense_category,allocation_scope,
    debit_account_code,credit_account_code,default_cost_code
  ) values
    (p_workspace_id,'Paliwo i flota',500,'purchase',null,'fuel',null,'403-01',null,'FLEET'),
    (p_workspace_id,'Zakup na magazyn centralny',450,'purchase','material',null,'inventory','310-01',null,'INVENTORY'),
    (p_workspace_id,'Narzędzia i wyposażenie',420,'purchase',null,'equipment',null,'405-01',null,'EQUIPMENT'),
    (p_workspace_id,'Materiał bezpośredni inwestycji',400,'purchase','material',null,'project','401-02',null,'MATERIAL'),
    (p_workspace_id,'Koszt ogólny firmy',380,'purchase',null,null,'overhead','409-01',null,'OVERHEAD'),
    (p_workspace_id,'Usługa obca',300,'purchase','service',null,null,'402-01',null,'SERVICE'),
    (p_workspace_id,'Pozostały koszt',100,'purchase',null,null,null,'409-01',null,'UNASSIGNED'),
    (p_workspace_id,'Sprzedaż usług',300,'sale',null,null,null,null,'701-01','REVENUE')
  on conflict(workspace_id,name) do nothing;
end $$;
revoke all on function public.ensure_default_accounting_rules(uuid) from public,anon,authenticated;
grant execute on function public.ensure_default_accounting_rules(uuid) to service_role;

insert into public.accounting_settings(workspace_id)
select id from public.workspaces
on conflict(workspace_id) do nothing;

insert into public.accounting_export_profiles(workspace_id,name,adapter,is_default)
select id,'Octopus CSV','generic_csv',true from public.workspaces
on conflict(workspace_id,name) do nothing;
