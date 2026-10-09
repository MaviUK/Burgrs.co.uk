-- Incremental fix for existing installations: keep the five-minute worker within its database timeout.
create or replace function public.season_review_candidates()
returns table(season_id uuid,show_id uuid,season_number integer,release_mode text,finale_at timestamptz,eligible_at timestamptz)
language sql stable set search_path='' as $$
 -- Bound settings to one row and filter recent finales before aggregating seasons.
 with settings as materialized (
 select author_id,initialized_at,weekly_delay_hours,binge_delay_hours
 from public.tv_season_review_settings where id and enabled limit 1
 ), recent_finales as materialized (
 select f.season_id,f.aired_date,f.episode_number,cfg.author_id,
   cfg.weekly_delay_hours,cfg.binge_delay_hours
 from settings cfg
 join public.episodes f on f.is_finale and not coalesce(f.is_special,false)
   and f.aired_date >= (cfg.initialized_at at time zone 'Europe/London')::date
   and f.aired_date <= current_date
 ), candidates as (
 select se.id season_id,se.show_id,se.season_number,
   case when a.first_date=a.last_date and a.n>1 then 'binge' else 'weekly' end release_mode,
   a.final_time finale_at,
   f.weekly_delay_hours,f.binge_delay_hours
 from recent_finales f
 join public.seasons se on se.id=f.season_id and se.season_number>0 and se.season_type='official'
 join public.shows sh on sh.id=se.show_id
 cross join lateral (
   select count(*) n,count(e.aired_date) dated,
     min(e.aired_date) first_date,max(e.aired_date) last_date,
     max(e.episode_number) max_episode,
     max(case when e.aired_at is not null and (e.aired_at at time zone 'UTC')::time <> time '00:00'
       then e.aired_at else (e.aired_date::timestamp + interval '23 hours 59 minutes 59 seconds')
       at time zone (case when sh.original_country in ('US','USA') then 'America/New_York'
         when sh.original_country in ('GB','UK') then 'Europe/London' else 'UTC' end) end) final_time
   from public.episodes e where e.season_id=se.id and not coalesce(e.is_special,false) and e.episode_number>0
 ) a
 where a.n>0 and a.n=a.dated and a.last_date=f.aired_date
   and a.max_episode=f.episode_number and (se.episode_count is null or se.episode_count<=a.n)
   and a.final_time<=now()
   and exists(select 1 from public.user_shows_new us where us.user_id=f.author_id and us.show_id=sh.id and us.archived_at is null)
 ) select distinct c.season_id,c.show_id,c.season_number,c.release_mode,c.finale_at,
   c.finale_at+make_interval(hours=>case when c.release_mode='binge' then c.binge_delay_hours else c.weekly_delay_hours end)
 from candidates c;
$$;
