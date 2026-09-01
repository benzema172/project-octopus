create or replace function public.capture_ai_review_as_brain_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_action_label text;
  v_entity_label text;
  v_note text;
  v_tags text[];
begin
  -- Knowledge reviews already modify Brain directly. Autopilot decisions are metrics,
  -- never trusted training precedents: only a human review may become durable memory.
  if new.entity_type = 'knowledge_entry'
     or coalesce(new.note, '') ilike 'Autopilot AI:%' then
    return new;
  end if;

  if new.document_id is not null then
    select d.category into v_category
    from public.documents d
    where d.id = new.document_id;
  end if;

  v_action_label := case when new.action = 'approve' then 'zatwierdzono' else 'odrzucono' end;
  v_entity_label := coalesce(nullif(new.entity_type, ''), 'element');
  v_note := nullif(trim(coalesce(new.note, '')), '');
  v_tags := array_remove(array[
    'brain-decision',
    'human-reviewed',
    'review:' || coalesce(nullif(new.action, ''), 'unknown'),
    'entity:' || v_entity_label,
    case when v_category is not null then 'category:' || v_category else null end
  ], null);

  insert into public.knowledge_entries (
    workspace_id, source_project_id, entry_type, title, summary, problem, solution, tags,
    metrics, source_references, status, approved_by, approved_at, created_at, updated_at
  ) values (
    new.workspace_id,
    new.project_id,
    'ai_decision',
    'Decyzja Brain · ' || v_entity_label || ' · ' || v_action_label,
    'Zweryfikowana przez człowieka decyzja dla elementu typu ' || v_entity_label ||
      case when v_category is not null then ' (kategoria: ' || v_category || ')' else '' end || '.',
    'Stan przed decyzją: ' || coalesce(new.previous_status, 'brak') || '. Proponowany wynik: ' || coalesce(new.next_status, 'brak') || '.',
    case
      when new.action = 'approve' then 'Traktuj ten wynik jako pozytywny precedens po weryfikacji człowieka.'
      else 'Traktuj ten wynik jako negatywny precedens: podobna propozycja wymaga większej ostrożności i kontroli człowieka.'
    end || case when v_note is not null then ' Uwaga człowieka: ' || left(v_note, 1200) else '' end,
    v_tags,
    jsonb_build_object('review_action', new.action, 'previous_status', new.previous_status, 'next_status', new.next_status, 'category', v_category),
    jsonb_build_object('review_action_id', new.id, 'entity_type', new.entity_type, 'entity_id', new.entity_id, 'document_id', new.document_id),
    'approved',
    new.decided_by,
    coalesce(new.created_at, now()),
    coalesce(new.created_at, now()),
    coalesce(new.created_at, now())
  );

  return new;
end;
$$;

-- Remove any memory created from automatic Autopilot decisions before this guard existed.
delete from public.knowledge_entries k
using public.ai_review_actions a
where k.entry_type = 'ai_decision'
  and k.source_references ->> 'review_action_id' = a.id::text
  and coalesce(a.note, '') ilike 'Autopilot AI:%';