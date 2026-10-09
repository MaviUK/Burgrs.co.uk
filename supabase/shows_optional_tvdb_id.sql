-- TMDB-only shows are valid catalog entries, even when TVDB has no mapping.
-- Keep both providers' unique indexes and all UUID relationships intact.
begin;
set local lock_timeout = '5s';

alter table public.shows alter column tvdb_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shows'::regclass
      and conname = 'shows_provider_id_required'
  ) then
    alter table public.shows
      add constraint shows_provider_id_required
      check (tvdb_id is not null or tmdb_id is not null);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
