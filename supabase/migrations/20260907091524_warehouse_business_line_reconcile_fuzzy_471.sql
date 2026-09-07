create or replace function private.sanitize_warehouse_business_document_470(p_doc jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_lines jsonb := case when jsonb_typeof(p_doc->'lines')='array' then p_doc->'lines' else '[]'::jsonb end;
  v_target numeric := public.octopus_numeric(p_doc->>'netAmount');
  v_total numeric := 0;
  v_len integer;
  v_i integer;
  v_j integer;
  v_li jsonb;
  v_lj jsonb;
  v_key_i text;
  v_key_j text;
  v_fuzzy_i text;
  v_fuzzy_j text;
  v_unit_i text;
  v_unit_j text;
  v_net_i numeric;
  v_net_j numeric;
  v_gross_i numeric;
  v_gross_j numeric;
  v_qty_i numeric;
  v_qty_j numeric;
  v_price_i numeric;
  v_price_j numeric;
  v_conf_i numeric;
  v_conf_j numeric;
  v_res_i numeric;
  v_res_j numeric;
  v_current_error numeric;
  v_error_remove_i numeric;
  v_error_remove_j numeric;
  v_remove integer;
  v_next jsonb;
  v_changed boolean;
  v_tax numeric;
  v_unit_price numeric;
  v_net numeric;
  v_qty numeric;
  v_line jsonb;
begin
  if jsonb_array_length(v_lines)=0 then return p_doc; end if;

  select coalesce(sum(coalesce(public.octopus_numeric(value->>'netAmount'),0)),0)
    into v_total
  from jsonb_array_elements(v_lines);

  if v_target is not null and v_target > 0 then
    loop
      v_changed := false;
      v_len := jsonb_array_length(v_lines);
      exit when v_len < 2;

      for v_i in 0..v_len-2 loop
        v_li := v_lines->v_i;
        v_key_i := public.normalize_material_key(v_li->>'description');
        v_fuzzy_i := regexp_replace(v_key_i,'[aeiouyąęó]','','g');
        v_unit_i := public.normalize_material_key(coalesce(v_li->>'unit',''));
        v_net_i := public.octopus_numeric(v_li->>'netAmount');
        v_gross_i := public.octopus_numeric(v_li->>'grossAmount');
        if v_key_i='' or v_net_i is null or v_net_i <= 0 then continue; end if;

        for v_j in v_i+1..v_len-1 loop
          v_lj := v_lines->v_j;
          v_key_j := public.normalize_material_key(v_lj->>'description');
          v_fuzzy_j := regexp_replace(v_key_j,'[aeiouyąęó]','','g');
          v_unit_j := public.normalize_material_key(coalesce(v_lj->>'unit',''));
          v_net_j := public.octopus_numeric(v_lj->>'netAmount');
          v_gross_j := public.octopus_numeric(v_lj->>'grossAmount');
          v_qty_i := public.octopus_numeric(v_li->>'quantity');
          v_qty_j := public.octopus_numeric(v_lj->>'quantity');

          if (v_key_i <> v_key_j and (v_fuzzy_i='' or v_fuzzy_i<>v_fuzzy_j))
             or v_net_j is null
             or abs(v_net_i-v_net_j) > 0.02
             or (v_unit_i<>'' and v_unit_j<>'' and v_unit_i<>v_unit_j)
             or (v_qty_i is not null and v_qty_j is not null and abs(v_qty_i-v_qty_j)>0.0001 and v_key_i<>v_key_j)
             or (v_gross_i is not null and v_gross_j is not null and abs(v_gross_i-v_gross_j)>0.03)
          then continue; end if;

          v_current_error := abs(v_total-v_target);
          v_error_remove_i := abs((v_total-v_net_i)-v_target);
          v_error_remove_j := abs((v_total-v_net_j)-v_target);
          if least(v_error_remove_i,v_error_remove_j) + 0.02 >= v_current_error then continue; end if;

          v_price_i := public.octopus_numeric(v_li->>'unitPrice');
          v_price_j := public.octopus_numeric(v_lj->>'unitPrice');
          v_res_i := case when v_qty_i is not null and v_price_i is not null then abs(v_qty_i*v_price_i-v_net_i) else 999999 end;
          v_res_j := case when v_qty_j is not null and v_price_j is not null then abs(v_qty_j*v_price_j-v_net_j) else 999999 end;
          v_conf_i := coalesce(public.octopus_numeric(v_li->>'confidence'),0);
          v_conf_j := coalesce(public.octopus_numeric(v_lj->>'confidence'),0);

          if v_res_i > v_res_j + 0.005 then v_remove := v_i;
          elsif v_res_j > v_res_i + 0.005 then v_remove := v_j;
          elsif v_conf_i + 0.0001 < v_conf_j then v_remove := v_i;
          else v_remove := v_j;
          end if;

          v_next := '[]'::jsonb;
          for v_i in 0..v_len-1 loop
            if v_i <> v_remove then v_next := v_next || jsonb_build_array(v_lines->v_i); end if;
          end loop;
          v_lines := v_next;
          v_total := case when v_remove=v_j then v_total-v_net_j else v_total-v_net_i end;
          v_changed := true;
          exit;
        end loop;
        exit when v_changed;
      end loop;
      exit when not v_changed;
    end loop;
  end if;

  v_next := '[]'::jsonb;
  for v_i in 0..jsonb_array_length(v_lines)-1 loop
    v_line := v_lines->v_i;
    v_tax := public.octopus_numeric(v_line->>'taxRate');
    if v_tax is not null and v_tax > 0 and v_tax <= 1 then
      v_line := jsonb_set(v_line,'{taxRate}',to_jsonb(round(v_tax*100,4)),true);
    end if;
    v_qty := public.octopus_numeric(v_line->>'quantity');
    v_net := public.octopus_numeric(v_line->>'netAmount');
    if v_qty is not null and v_qty <> 0 and v_net is not null then
      v_unit_price := round(v_net/v_qty,6);
      v_line := jsonb_set(v_line,'{unitPrice}',to_jsonb(v_unit_price),true);
    end if;
    v_next := v_next || jsonb_build_array(v_line);
  end loop;

  return jsonb_set(p_doc,'{lines}',v_next,true);
end;
$function$;
