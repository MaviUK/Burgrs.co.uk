-- Protect the official Burgrs TV account from user unfollow/block actions.
-- Live project system account:
-- add17d5c-c8fd-4430-904f-271342100bf9

create or replace function public.get_system_admin_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where lower(coalesce(username,'')) in ('burgrs tv', 'burgers tv')
     or lower(coalesce(display_name,'')) in ('burgrs tv', 'burgers tv')
  order by
    case
      when lower(coalesce(username,'')) = 'burgrs tv' then 0
      when lower(coalesce(display_name,'')) = 'burgrs tv' then 1
      else 2
    end,
    created_at asc
  limit 1
$$;

drop policy if exists "Users can unfollow users" on public.user_follows;
create policy "Users can unfollow users"
  on public.user_follows
  for delete
  to authenticated
  using (
    (select auth.uid()) = follower_id
    and following_id <> 'add17d5c-c8fd-4430-904f-271342100bf9'::uuid
  );

drop policy if exists "Users can block other users" on public.user_blocks;
create policy "Users can block other users"
  on public.user_blocks
  for insert
  to authenticated
  with check (
    (select auth.uid()) = blocker_id
    and blocker_id <> blocked_id
    and blocked_id <> 'add17d5c-c8fd-4430-904f-271342100bf9'::uuid
  );

alter table public.user_blocks
  drop constraint if exists user_blocks_cannot_block_burgrs_tv;

alter table public.user_blocks
  add constraint user_blocks_cannot_block_burgrs_tv
  check (blocked_id <> 'add17d5c-c8fd-4430-904f-271342100bf9'::uuid);
