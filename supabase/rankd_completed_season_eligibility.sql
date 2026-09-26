-- Rank'd should only include:
--   1. shows marked completed; or
--   2. shows marked watching where the user has watched every non-special
--      episode in at least one numbered season.
--
-- This function keeps the filtering in Postgres so Rank'd pagination does not
-- fetch ineligible shows and discard them on the client.

create or replace function public.get_rankd_eligible_shows(
  p_offset integer default 0,
  p_limit integer default 80
)
returns table (
  show_id uuid,
  watch_status text,
  id uuid,
  tvdb_id bigint,
  name text,
  poster_url text
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    us.show_id,
    us.watch_status,
    s.id,
    s.tvdb_id,
    s.name,
    s.poster_url
  from public.user_shows_new us
  join public.shows s
    on s.id = us.show_id
  where us.user_id = (select auth.uid())
    and us.watch_status in ('completed', 'watching')
    and (
      us.watch_status = 'completed'
      or exists (
        select 1
        from public.episodes e
        left join public.watched_episodes we
          on we.episode_id = e.id
         and we.user_id = us.user_id
        where e.show_id = us.show_id
          and e.season_number > 0
          and coalesce(e.is_special, false) = false
        group by e.season_number
        having count(*) > 0
           and count(we.episode_id) = count(*)
      )
    )
  order by us.added_at desc, us.show_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 80), 1), 500);
$function$;

revoke all on function public.get_rankd_eligible_shows(integer, integer) from public;
revoke all on function public.get_rankd_eligible_shows(integer, integer) from anon;
grant execute on function public.get_rankd_eligible_shows(integer, integer) to authenticated;
