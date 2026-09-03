begin;

-- Supabase exposes pgcrypto's gen_random_bytes in normal environments.
-- PGlite (used by the full migration-chain contract) only guarantees gen_random_uuid.
-- Install a small fallback only when no compatible function is already resolvable.
do $$
begin
  if to_regprocedure('gen_random_bytes(integer)') is null then
    execute $function$
      create function public.gen_random_bytes(p_count integer)
      returns bytea
      language plpgsql
      volatile
      set search_path = pg_catalog, public
      as $body$
      declare
        v_result bytea := ''::bytea;
      begin
        if p_count is null or p_count < 0 then
          raise exception 'gen_random_bytes length must be non-negative';
        end if;
        while octet_length(v_result) < p_count loop
          v_result := v_result || decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
        end loop;
        return substring(v_result from 1 for p_count);
      end;
      $body$
    $function$;
  end if;
end;
$$;

commit;
