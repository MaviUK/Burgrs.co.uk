-- BURGRS RLS auth helper performance optimisation
-- Audited/applied to live Supabase project nboalhdybuzfxsrbrcwb on 2026-09-25.
-- Rewrites direct auth.uid() policy calls as (select auth.uid()) so Postgres
-- evaluates the current user once per query instead of once per row.

begin;

create temporary table _rls_policy_before on commit drop as
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public'
  and (
    (qual is not null
      and qual ~ 'auth\.uid\(\)'
      and qual !~* 'select\s+auth\.uid\(\)')
    or
    (with_check is not null
      and with_check ~ 'auth\.uid\(\)'
      and with_check !~* 'select\s+auth\.uid\(\)')
  );

do $$
declare
  r record;
  ddl text;
  new_qual text;
  new_check text;
begin
  for r in
    select *
    from _rls_policy_before
    order by tablename, policyname
  loop
    new_qual := case
      when r.qual is null then null
      else replace(r.qual, 'auth.uid()', '(select auth.uid())')
    end;

    new_check := case
      when r.with_check is null then null
      else replace(r.with_check, 'auth.uid()', '(select auth.uid())')
    end;

    ddl := format(
      'alter policy %I on %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );

    if new_qual is not null then
      ddl := ddl || format(' using (%s)', new_qual);
    end if;

    if new_check is not null then
      ddl := ddl || format(' with check (%s)', new_check);
    end if;

    execute ddl;
  end loop;
end
$$;

commit;
