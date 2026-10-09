-- Backend-only season review pipeline. Apply once to the live project.
alter table public.creator_posts add column if not exists is_auto_season_review boolean not null default false;
create table public.tv_season_review_settings (
  id boolean primary key default true check (id),
  author_id uuid not null references public.profiles(id),
  enabled boolean not null default false,
  initialized_at timestamptz not null default now(),
  weekly_delay_hours integer not null default 24 check (weekly_delay_hours = 24),
  binge_delay_hours integer not null default 168 check (binge_delay_hours = 168),
  max_posts_per_day integer not null default 6 check (max_posts_per_day between 1 and 20),
  last_error text,
  last_run_at timestamptz
);
create table public.tv_season_reviews (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  release_mode text not null check (release_mode in ('weekly','binge')),
  finale_at timestamptz not null,
  eligible_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','held','published','failed')),
  step text not null default 'research' check (step in ('research','draft','verify','publish')),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  stage_attempts integer not null default 0,
  evidence_attempts integer not null default 0,
  locked_until timestamptz,
  lock_token uuid,
  evidence jsonb,
  draft jsonb,
  verification jsonb,
  creator_post_id uuid references public.creator_posts(id) on delete set null,
  model text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (show_id,season_number)
);
create table public.tv_season_review_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  job_id uuid references public.tv_season_reviews(id) on delete set null,
  step text,
  status text not null default 'running',
  message text
);
create index tv_season_reviews_due_idx on public.tv_season_reviews(next_attempt_at,eligible_at) where status in ('queued','held','processing');
create index tv_season_reviews_show_idx on public.tv_season_reviews(show_id);
create index tv_season_reviews_season_idx on public.tv_season_reviews(season_id);
create index tv_season_reviews_post_idx on public.tv_season_reviews(creator_post_id);
create index tv_season_review_runs_job_idx on public.tv_season_review_runs(job_id);
alter table public.tv_season_review_settings enable row level security;
alter table public.tv_season_reviews enable row level security;
alter table public.tv_season_review_runs enable row level security;
revoke all on public.tv_season_review_settings,public.tv_season_reviews,public.tv_season_review_runs from public,anon,authenticated;
grant all on public.tv_season_review_settings,public.tv_season_reviews,public.tv_season_review_runs to service_role;
insert into public.tv_season_review_settings(author_id)
select id from public.profiles where is_system_admin and username='Burgrs TV' limit 1;

-- A listed final episode is a candidate, never sufficient evidence to publish.
-- Treat midnight timestamps as date-only placeholders; use end of broadcast day.
create function public.season_review_candidates()
returns table(season_id uuid,show_id uuid,season_number integer,release_mode text,finale_at timestamptz,eligible_at timestamptz)
language sql stable set search_path='' as $$
 with candidates as (
 select se.id season_id,se.show_id,se.season_number,
   case when a.first_date=a.last_date and a.n>1 then 'binge' else 'weekly' end release_mode,
   a.final_time finale_at,
   cfg.weekly_delay_hours,cfg.binge_delay_hours
 from public.tv_season_review_settings cfg
 join public.episodes f on f.is_finale and not coalesce(f.is_special,false)
   and f.aired_date >= (cfg.initialized_at at time zone 'Europe/London')::date
   and f.aired_date <= current_date
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
 where cfg.id and cfg.enabled and a.n>0 and a.n=a.dated and a.last_date=f.aired_date
   and a.max_episode=f.episode_number and (se.episode_count is null or se.episode_count<=a.n)
   and a.final_time<=now()
   and exists(select 1 from public.user_shows_new us where us.user_id=cfg.author_id and us.show_id=sh.id and us.archived_at is null)
 ) select distinct c.season_id,c.show_id,c.season_number,c.release_mode,c.finale_at,
   c.finale_at+make_interval(hours=>case when c.release_mode='binge' then c.binge_delay_hours else c.weekly_delay_hours end)
 from candidates c;
$$;
create function public.season_review_enqueue() returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into public.tv_season_reviews(season_id,show_id,season_number,release_mode,finale_at,eligible_at)
 select * from public.season_review_candidates() on conflict(show_id,season_number) do nothing;
 get diagnostics n=row_count;
 -- Recheck dates and release mode while a job is waiting: schedules can change.
 update public.tv_season_reviews j set finale_at=c.finale_at,eligible_at=c.eligible_at,release_mode=c.release_mode
 from public.season_review_candidates() c where j.season_id=c.season_id and j.status in ('queued','held');
 return n;
end;
$$;
create function public.season_review_claim(p_token uuid) returns setof public.tv_season_reviews
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.tv_season_review_settings where id and enabled) then return; end if;
 return query with candidate as (
 select j.id from public.tv_season_reviews j
 where j.eligible_at<=now() and j.next_attempt_at<=now()
   and (j.status in ('queued','held') or (j.status='processing' and j.locked_until<now()))
   and j.stage_attempts<3 and j.evidence_attempts<8
 order by (j.step='publish') desc,j.eligible_at,j.created_at for update skip locked limit 1
 ) update public.tv_season_reviews j set status='processing',lock_token=p_token,
   locked_until=now()+interval '5 minutes',attempts=j.attempts+1,stage_attempts=j.stage_attempts+1,updated_at=now()
 from candidate c where j.id=c.id returning j.*;
end;
$$;
-- Transactional publish prevents duplicate posts after network errors or worker retries.
create function public.season_review_publish(p_job uuid,p_token uuid,p_title text,p_body text)
returns uuid language plpgsql set search_path='' as $$
declare j public.tv_season_reviews%rowtype; cfg public.tv_season_review_settings%rowtype; post_id uuid; picture text;
begin
 select * into cfg from public.tv_season_review_settings where id for update;
 if not cfg.enabled then raise exception 'Reviews paused'; end if;
 select * into j from public.tv_season_reviews where id=p_job for update;
 if j.status='published' then return j.creator_post_id; end if;
 if j.id is null or j.status<>'processing' or j.step<>'publish' or j.lock_token is distinct from p_token or j.locked_until<now() then raise exception 'Invalid review lease'; end if;
 if j.eligible_at>now() or coalesce((j.verification->>'approved')::boolean,false)=false then raise exception 'Review not eligible or verified'; end if;
 if not exists(select 1 from public.season_review_candidates() c where c.season_id=j.season_id and c.eligible_at<=now()) then raise exception 'Season schedule changed'; end if;
 if (select count(*) from public.tv_season_reviews where published_at>now()-interval '24 hours')>=cfg.max_posts_per_day then raise exception 'Daily review limit'; end if;
 if length(p_title)<10 or length(p_title)>180 or length(p_body)<300 or length(p_body)>8000
   or position('AI-generated' in p_body)=0 then raise exception 'Invalid review format'; end if;
 select coalesce(nullif(backdrop_url,''),nullif(poster_url,'')) into picture from public.shows where id=j.show_id;
 insert into public.creator_posts(user_id,title,body,post_type,visibility,image_url,is_auto_news,is_auto_season_review,source_name,related_show_id)
 values(cfg.author_id,p_title,p_body,'post','public',picture,false,true,'Burgrs TV · AI-generated season review',j.show_id)
 returning id into post_id;
 update public.tv_season_reviews set status='published',creator_post_id=post_id,published_at=now(),updated_at=now(),lock_token=null,locked_until=null,last_error=null where id=j.id;
 return post_id;
end;
$$;
revoke all on function public.season_review_candidates(),public.season_review_enqueue(),public.season_review_claim(uuid),public.season_review_publish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.season_review_candidates(),public.season_review_enqueue(),public.season_review_claim(uuid),public.season_review_publish(uuid,uuid,text,text) to service_role;
