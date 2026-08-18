begin;

-- Project Octopus 1.0.2 Stability
-- Runtime regressions found after 1.0.1 plus integrity guards that must live in PostgreSQL.

alter table public.project_anomalies add column if not exists first_detected_at timestamptz;
alter table public.project_anomalies add column if not exists last_seen_at timestamptz;
update public.project_anomalies
set first_detected_at=coalesce(first_detected_at,detected_at,now()),
    last_seen_at=coalesce(last_seen_at,detected_at,now())
where first_detected_at is null or last_seen_at is null;
alter table public.project_anomalies alter column first_detected_at set default now();
alter table public.project_anomalies alter column first_detected_at set not null;
alter table public.project_anomalies alter column last_seen_at set default now();
alter table public.project_anomalies alter column last_seen_at set not null;

create or replace function public.preserve_project_anomaly_history()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.first_detected_at:=coalesce(old.first_detected_at,old.detected_at,new.detected_at,now());
  if new.anomaly_key like 'auto:%' and new.status='open' then
    if new.detected_at is distinct from old.detected_at or old.status is distinct from 'open' then
      new.last_seen_at:=coalesce(new.detected_at,now());
    else
      new.last_seen_at:=coalesce(old.last_seen_at,now());
    end if;
    new.detected_at:=coalesce(old.detected_at,old.first_detected_at,new.detected_at,now());
  else
    new.last_seen_at:=coalesce(new.last_seen_at,old.last_seen_at,now());
  end if;
  return new;
end;
$$;
drop trigger if exists project_anomaly_history_guard on public.project_anomalies;
create trigger project_anomaly_history_guard before update on public.project_anomalies for each row execute function public.preserve_project_anomaly_history();

create or replace function public.guard_report_run_completion()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='completed' and not exists(select 1 from public.report_snapshots rs where rs.report_run_id=new.id) then
    new.status:='running';
    new.finished_at:=null;
  end if;
  return new;
end;
$$;
drop trigger if exists report_run_completion_guard on public.report_runs;
create trigger report_run_completion_guard before insert or update on public.report_runs for each row execute function public.guard_report_run_completion();

create or replace function public.finalize_report_run_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.report_runs set status='completed',started_at=coalesce(started_at,new.created_at,now()),finished_at=coalesce(new.closed_at,now()) where id=new.report_run_id;
  return new;
end;
$$;
drop trigger if exists report_snapshot_finalize_run on public.report_snapshots;
create trigger report_snapshot_finalize_run after insert or update of closed_at on public.report_snapshots for each row execute function public.finalize_report_run_from_snapshot();

update public.report_runs rr set status='error',finished_at=null
where rr.status='completed' and not exists(select 1 from public.report_snapshots rs where rs.report_run_id=rr.id);
create index if not exists report_runs_workspace_status_created_idx on public.report_runs(workspace_id,status,created_at desc);

create or replace function public.record_payment_atomic(p_workspace_id uuid,p_invoice_id uuid,p_payment_date date,p_amount numeric,p_bank_reference text,p_actor_id uuid)
returns table(result_payment_id uuid,paid_total numeric,invoice_status text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype; v_payment_id uuid; v_paid_before numeric; v_paid numeric; v_status text;
begin
  if p_amount is null or p_amount<=0 then raise exception 'Kwota płatności musi być większa od zera.'; end if;
  select * into v_invoice from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.'; end if;
  if lower(coalesce(v_invoice.status,'')) in ('cancelled','canceled','void','rejected') then raise exception 'Nie można zarejestrować płatności do anulowanej faktury.'; end if;
  select coalesce(sum(p.amount),0) into v_paid_before from public.payments p where p.workspace_id=p_workspace_id and p.invoice_id=p_invoice_id and p.status='confirmed';
  if v_paid_before+p_amount>coalesce(v_invoice.gross_amount,0)+0.01 then
    raise exception 'Płatność przekracza kwotę pozostałą do zapłaty. Pozostało: %.',greatest(coalesce(v_invoice.gross_amount,0)-v_paid_before,0);
  end if;
  insert into public.payments(workspace_id,invoice_id,payment_date,amount,bank_reference,status)
  values(p_workspace_id,p_invoice_id,coalesce(p_payment_date,current_date),p_amount,nullif(trim(p_bank_reference),''),'confirmed') returning id into v_payment_id;
  v_paid:=v_paid_before+p_amount;
  v_status:=case when v_paid+0.01>=coalesce(v_invoice.gross_amount,0) then 'paid' else 'partially_paid' end;
  update public.invoices set paid_amount=v_paid,status=v_status where id=p_invoice_id and workspace_id=p_workspace_id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_actor_id,'payment.created_atomic','payment',v_payment_id::text,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'paid_total',v_paid,'invoice_status',v_status));
  return query select v_payment_id,v_paid,v_status;
end;
$$;
revoke all on function public.record_payment_atomic(uuid,uuid,date,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.record_payment_atomic(uuid,uuid,date,numeric,text,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260818_102_stability') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
