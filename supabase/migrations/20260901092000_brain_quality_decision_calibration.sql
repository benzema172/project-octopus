create or replace function public.brain_calibrated_confidence(
  p_workspace_id uuid,
  p_category text,
  p_raw_confidence numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_metrics jsonb;
  v_analyses numeric := 0;
  v_average_confidence numeric := 0;
  v_correction_rate numeric := 0;
  v_errors numeric := 0;
  v_approvals numeric := 0;
  v_rejections numeric := 0;
  v_reviewed numeric := 0;
  v_approval_rate numeric := 0;
  v_category_count numeric := 0;
  v_category_confidence numeric := 0;
  v_adjustment numeric := 0;
  v_result numeric;
begin
  v_metrics := public.get_ai_quality_metrics(p_workspace_id, 30);
  v_analyses := coalesce((v_metrics ->> 'analyses')::numeric, 0);
  v_average_confidence := coalesce((v_metrics ->> 'averageConfidence')::numeric, coalesce(p_raw_confidence, 0));
  v_correction_rate := coalesce((v_metrics ->> 'correctionRate')::numeric, 0);
  v_errors := coalesce((v_metrics ->> 'errors')::numeric, 0);

  select
    count(*) filter (where 'review:approve' = any(coalesce(k.tags, '{}'::text[]))),
    count(*) filter (where 'review:reject' = any(coalesce(k.tags, '{}'::text[])))
  into v_approvals, v_rejections
  from public.knowledge_entries k
  where k.workspace_id = p_workspace_id
    and k.entry_type = 'ai_decision'
    and k.status = 'approved'
    and 'human-reviewed' = any(coalesce(k.tags, '{}'::text[]))
    and ('category:' || coalesce(p_category, '')) = any(coalesce(k.tags, '{}'::text[]))
    and k.created_at >= now() - interval '180 days';

  select
    coalesce((row ->> 'count')::numeric, 0),
    coalesce((row ->> 'avg_confidence')::numeric, 0)
  into v_category_count, v_category_confidence
  from jsonb_array_elements(coalesce(v_metrics -> 'categories', '[]'::jsonb)) row
  where row ->> 'category' = p_category
  limit 1;

  if v_correction_rate >= 0.25 then
    v_adjustment := v_adjustment - 0.12;
  elsif v_correction_rate >= 0.10 then
    v_adjustment := v_adjustment - 0.06;
  end if;

  if v_analyses >= 5 and v_average_confidence < 0.75 then
    v_adjustment := v_adjustment - 0.04;
  end if;

  if v_analyses >= 5 and v_errors / greatest(v_analyses, 1) >= 0.15 then
    v_adjustment := v_adjustment - 0.04;
  end if;

  if coalesce(v_category_count, 0) >= 3 and coalesce(v_category_confidence, 0) < 0.72 then
    v_adjustment := v_adjustment - 0.05;
  end if;

  v_reviewed := coalesce(v_approvals, 0) + coalesce(v_rejections, 0);
  if v_reviewed >= 2 then
    v_approval_rate := v_approvals / v_reviewed;
    if v_approval_rate <= 0.50 then
      v_adjustment := v_adjustment - 0.15;
    elsif v_approval_rate < 0.75 then
      v_adjustment := v_adjustment - 0.08;
    elsif v_approval_rate >= 0.90 and v_reviewed >= 4 then
      v_adjustment := v_adjustment + 0.03;
    end if;
  elsif v_reviewed = 1 and v_rejections = 1 then
    v_adjustment := v_adjustment - 0.08;
  end if;

  -- Positive memory can never create near-certainty. Negative feedback is allowed
  -- to materially lower confidence and therefore force more human review.
  v_result := greatest(0, least(0.99, coalesce(p_raw_confidence, 0) + v_adjustment));
  return round(v_result, 4);
exception when others then
  -- Quality memory must fail soft; a telemetry problem may not stop document intake.
  return greatest(0, least(0.99, coalesce(p_raw_confidence, 0)));
end;
$$;

create or replace function public.apply_brain_calibration_to_classification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw numeric;
  v_calibrated numeric;
begin
  if new.status <> 'proposed' then return new; end if;
  v_raw := coalesce(new.confidence, 0);
  v_calibrated := public.brain_calibrated_confidence(new.workspace_id, new.category, v_raw);
  new.confidence := v_calibrated;
  if v_calibrated < v_raw - 0.005 then
    new.rationale := concat_ws(' ', nullif(new.rationale, ''), 'Kalibracja Brain obniżyła pewność na podstawie historii jakości i decyzji człowieka.');
  elsif v_calibrated > v_raw + 0.005 then
    new.rationale := concat_ws(' ', nullif(new.rationale, ''), 'Kalibracja Brain uwzględniła silny pozytywny precedens człowieka.');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brain_calibrate_classification on public.document_classifications;
create trigger trg_brain_calibrate_classification
before insert or update of confidence, category, status on public.document_classifications
for each row execute function public.apply_brain_calibration_to_classification();

create or replace function public.propagate_brain_confidence_to_extraction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_confidence numeric;
begin
  if new.status <> 'proposed' then return new; end if;
  select c.confidence into v_confidence
  from public.document_classifications c
  where c.document_version_id = new.document_version_id
  order by c.created_at desc
  limit 1;
  if v_confidence is not null then
    new.confidence := least(coalesce(new.confidence, v_confidence), v_confidence);
    if new.payload is not null and new.payload ? 'confidence' then
      new.payload := jsonb_set(new.payload, '{confidence}', to_jsonb(new.confidence), true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brain_calibrate_extraction on public.document_extractions;
create trigger trg_brain_calibrate_extraction
before insert or update of confidence, payload, status on public.document_extractions
for each row execute function public.propagate_brain_confidence_to_extraction();

create or replace function public.propagate_brain_confidence_to_module_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_confidence numeric;
begin
  if new.status <> 'proposed' then return new; end if;
  select c.confidence into v_confidence
  from public.document_classifications c
  where c.document_version_id = new.document_version_id
  order by c.created_at desc
  limit 1;
  if v_confidence is not null then
    new.confidence := least(coalesce(new.confidence, v_confidence), v_confidence);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brain_calibrate_module_proposal on public.document_module_proposals;
create trigger trg_brain_calibrate_module_proposal
before insert or update of confidence, status on public.document_module_proposals
for each row execute function public.propagate_brain_confidence_to_module_proposal();

create or replace function public.propagate_brain_confidence_to_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_confidence numeric;
begin
  if new.ai_status <> 'review' or new.current_version_id is null then return new; end if;
  select c.confidence into v_confidence
  from public.document_classifications c
  where c.document_version_id = new.current_version_id
  order by c.created_at desc
  limit 1;
  if v_confidence is not null then
    new.ai_confidence := least(coalesce(new.ai_confidence, v_confidence), v_confidence);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brain_calibrate_document on public.documents;
create trigger trg_brain_calibrate_document
before update of ai_confidence, ai_status on public.documents
for each row execute function public.propagate_brain_confidence_to_document();

create or replace function public.propagate_brain_confidence_to_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_confidence numeric;
begin
  if new.status <> 'review' then return new; end if;
  select c.confidence into v_confidence
  from public.document_classifications c
  where c.document_id = new.document_id
  order by c.created_at desc
  limit 1;
  if v_confidence is not null then
    new.confidence := least(coalesce(new.confidence, v_confidence), v_confidence);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brain_calibrate_intake on public.document_intakes;
create trigger trg_brain_calibrate_intake
before update of confidence, status on public.document_intakes
for each row execute function public.propagate_brain_confidence_to_intake();