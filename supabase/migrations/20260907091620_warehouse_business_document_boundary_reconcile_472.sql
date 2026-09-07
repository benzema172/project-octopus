create or replace function private.sanitize_warehouse_business_documents_472(p_docs jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_docs jsonb := coalesce(p_docs,'[]'::jsonb);
  v_len integer;
  v_i integer;
  v_j integer;
  v_a jsonb;
  v_b jsonb;
  v_no_a text;
  v_no_b text;
  v_date_a text;
  v_date_b text;
  v_net_a numeric;
  v_net_b numeric;
  v_gross_a numeric;
  v_gross_b numeric;
  v_sum_a numeric;
  v_sum_b numeric;
  v_err_a numeric;
  v_err_b numeric;
  v_remove integer;
  v_next jsonb;
  v_changed boolean;
begin
  if jsonb_typeof(v_docs) <> 'array' then return '[]'::jsonb; end if;
  loop
    v_changed := false;
    v_len := jsonb_array_length(v_docs);
    exit when v_len < 2;
    for v_i in 0..v_len-2 loop
      v_a := v_docs->v_i;
      v_no_a := public.normalize_material_key(v_a->>'documentNumber');
      v_date_a := coalesce(v_a->>'issueDate','');
      v_net_a := public.octopus_numeric(v_a->>'netAmount');
      v_gross_a := public.octopus_numeric(v_a->>'grossAmount');
      if v_no_a='' or v_net_a is null or v_net_a<=0 then continue; end if;
      select coalesce(sum(coalesce(public.octopus_numeric(value->>'netAmount'),0)),0) into v_sum_a
      from jsonb_array_elements(coalesce(v_a->'lines','[]'::jsonb));
      v_err_a := abs(v_sum_a-v_net_a);

      for v_j in v_i+1..v_len-1 loop
        v_b := v_docs->v_j;
        v_no_b := public.normalize_material_key(v_b->>'documentNumber');
        v_date_b := coalesce(v_b->>'issueDate','');
        v_net_b := public.octopus_numeric(v_b->>'netAmount');
        v_gross_b := public.octopus_numeric(v_b->>'grossAmount');
        if v_no_a<>v_no_b or v_date_a<>v_date_b or v_net_b is null or abs(v_net_a-v_net_b)>0.02 then continue; end if;
        if v_gross_a is not null and v_gross_b is not null and abs(v_gross_a-v_gross_b)>0.03 then continue; end if;
        select coalesce(sum(coalesce(public.octopus_numeric(value->>'netAmount'),0)),0) into v_sum_b
        from jsonb_array_elements(coalesce(v_b->'lines','[]'::jsonb));
        v_err_b := abs(v_sum_b-v_net_b);

        -- Same invoice number/date/totals can appear twice when an overlapping page
        -- is attributed to the next supplier. Drop only the clearly incomplete copy.
        if v_err_a <= 1 and v_err_b > greatest(5,v_net_b*0.05) then v_remove := v_j;
        elsif v_err_b <= 1 and v_err_a > greatest(5,v_net_a*0.05) then v_remove := v_i;
        else continue; end if;

        v_next := '[]'::jsonb;
        for v_i in 0..v_len-1 loop
          if v_i<>v_remove then v_next := v_next || jsonb_build_array(v_docs->v_i); end if;
        end loop;
        v_docs := v_next;
        v_changed := true;
        exit;
      end loop;
      exit when v_changed;
    end loop;
    exit when not v_changed;
  end loop;
  return v_docs;
end;
$function$;

create or replace function private.sanitize_warehouse_extraction_470()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_docs jsonb;
  v_doc jsonb;
  v_clean jsonb := '[]'::jsonb;
begin
  if new.extraction_type <> 'document_context' or jsonb_typeof(new.payload) <> 'object' then return new; end if;
  if jsonb_typeof(new.payload->'businessDocuments') <> 'array' then return new; end if;
  v_docs := new.payload->'businessDocuments';
  for v_doc in select value from jsonb_array_elements(v_docs) loop
    v_clean := v_clean || jsonb_build_array(private.sanitize_warehouse_business_document_470(v_doc));
  end loop;
  v_clean := private.sanitize_warehouse_business_documents_472(v_clean);
  new.payload := jsonb_set(new.payload,'{businessDocuments}',v_clean,true);
  if jsonb_array_length(v_clean)>0 then
    new.payload := jsonb_set(new.payload,'{businessDocument}',v_clean->0,true);
  end if;
  return new;
end;
$function$;

revoke all on function private.sanitize_warehouse_business_documents_472(jsonb) from public;
