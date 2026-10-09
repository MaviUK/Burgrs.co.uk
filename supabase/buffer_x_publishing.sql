-- New public Burgrs TV posts -> Buffer. Only service_role can access this state.
create schema if not exists burgrs_integrations;
revoke all on schema burgrs_integrations from public, anon, authenticated;

create table public.buffer_x_settings (
  id boolean primary key default true check (id),
  author_id uuid not null references public.profiles(id),
  enabled boolean not null default false,
  initialized_at timestamptz,
  channel_id text,
  channel_name text,
  channel_url text,
  locked_until timestamptz,
  run_id uuid,
  next_run_at timestamptz not null default now(),
  last_error text
);
create table public.buffer_x_outbox (
  post_id uuid primary key references public.creator_posts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','accepted','review','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sending_at timestamptz,
  buffer_post_id text,
  due_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index buffer_x_outbox_pending on public.buffer_x_outbox(next_attempt_at,created_at) where status='pending';
create table public.buffer_x_api_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
create index buffer_x_api_calls_time on public.buffer_x_api_calls(created_at);
alter table public.buffer_x_settings enable row level security;
alter table public.buffer_x_outbox enable row level security;
alter table public.buffer_x_api_calls enable row level security;
revoke all on public.buffer_x_settings, public.buffer_x_outbox, public.buffer_x_api_calls from public,anon,authenticated;
grant all on public.buffer_x_settings, public.buffer_x_outbox, public.buffer_x_api_calls to service_role;
grant usage,select on sequence public.buffer_x_api_calls_id_seq to service_role;

do $$
declare author uuid; author_count integer;
begin
  select count(*), (array_agg(id))[1] into author_count,author from public.profiles
    where is_system_admin and (lower(username)='burgrs tv' or lower(display_name)='burgrs tv');
  if author_count<>1 then raise exception 'Expected exactly one Burgrs TV system profile'; end if;
  insert into public.buffer_x_settings(id,author_id) values(true,author);
end $$;

create function burgrs_integrations.enqueue_buffer_x() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.visibility='public' and exists (
    select 1 from public.buffer_x_settings s where s.id and s.enabled
      and s.author_id=new.user_id and new.created_at>=s.initialized_at
  ) then
    insert into public.buffer_x_outbox(post_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function burgrs_integrations.enqueue_buffer_x() from public,anon,authenticated;
create trigger enqueue_buffer_x after insert or update of visibility on public.creator_posts
  for each row execute function burgrs_integrations.enqueue_buffer_x();

create function public.buffer_x_acquire(p_run uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.buffer_x_settings set run_id=p_run,locked_until=now()+interval '10 minutes'
    where id and next_run_at<=now() and (locked_until is null or locked_until<now());
  if not found then return false; end if;
  -- A terminated worker may already have submitted its request: never blindly replay it.
  update public.buffer_x_outbox set status='review',last_error='Worker interrupted; check Buffer before retrying'
    where status='sending';
  return true;
end $$;
create function public.buffer_x_claim(p_run uuid) returns setof public.buffer_x_outbox
language plpgsql security invoker set search_path='' as $$
begin
  if not exists (select 1 from public.buffer_x_settings where id and enabled and run_id=p_run and locked_until>now()) then return; end if;
  return query with candidate as (
    select post_id from public.buffer_x_outbox where status='pending' and next_attempt_at<=now()
    order by created_at,post_id for update skip locked limit 1
  ) update public.buffer_x_outbox o set status='sending',attempts=attempts+1,sending_at=now()
    from candidate c where o.post_id=c.post_id returning o.*;
end $$;
create function public.buffer_x_reserve_call(p_run uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.buffer_x_settings where id and run_id=p_run and locked_until>now() for update;
  if not found then return false; end if;
  -- Rolling limits leave headroom below Buffer Free's 100/day and 3,000/30 days.
  if (select count(*) from public.buffer_x_api_calls where created_at>now()-interval '24 hours')>=75
    or (select count(*) from public.buffer_x_api_calls where created_at>now()-interval '30 days')>=2500 then return false; end if;
  insert into public.buffer_x_api_calls default values;
  delete from public.buffer_x_api_calls where created_at<now()-interval '35 days';
  return true;
end $$;
revoke all on function public.buffer_x_acquire(uuid),public.buffer_x_claim(uuid),public.buffer_x_reserve_call(uuid) from public,anon,authenticated;
grant execute on function public.buffer_x_acquire(uuid),public.buffer_x_claim(uuid),public.buffer_x_reserve_call(uuid) to service_role;
