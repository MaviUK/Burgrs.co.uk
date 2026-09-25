-- BURGRS permissive RLS policy consolidation
-- Audited/applied to live Supabase project nboalhdybuzfxsrbrcwb on 2026-09-25.
-- Preserves existing effective OR semantics while removing redundant policies.

begin;

drop policy if exists "Authenticated users can read public creator list items" on public.creator_list_items;
drop policy if exists "Users can read own creator list items" on public.creator_list_items;
create policy "Authenticated users can read visible creator list items"
on public.creator_list_items
for select
to authenticated
using (
  exists (
    select 1
    from public.creator_lists cl
    where cl.id = creator_list_items.list_id
      and (
        coalesce(cl.visibility, 'public') = 'public'
        or cl.user_id = (select auth.uid())
      )
  )
);

drop policy if exists "Authenticated users can read public creator lists" on public.creator_lists;
drop policy if exists "Users can read own creator lists" on public.creator_lists;
create policy "Authenticated users can read visible creator lists"
on public.creator_lists
for select
to authenticated
using (
  coalesce(visibility, 'public') = 'public'
  or (select auth.uid()) = user_id
);

drop policy if exists "Users can delete own creator posts" on public.creator_posts;
drop policy if exists "Users can view public creator posts" on public.creator_posts;

drop policy if exists "Creator can view own subscribers" on public.creator_subscriptions;
drop policy if exists "Subscriber can view own subscriptions" on public.creator_subscriptions;
create policy "Users can view own creator subscriptions"
on public.creator_subscriptions
for select
to public
using (
  creator_id = (select auth.uid())
  or subscriber_id = (select auth.uid())
);

drop policy if exists "Manage own episode review votes" on public.episode_review_votes;
drop policy if exists "Users can view episode review votes" on public.episode_review_votes;

drop policy if exists "Authenticated users can insert episodes" on public.episodes;
drop policy if exists "Authenticated users can update episodes" on public.episodes;

drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Users can view their own profile" on public.profiles;

drop policy if exists "Users can read matchup comments" on public.rankd_matchup_comments;

drop policy if exists "Users can read matchups" on public.rankd_matchups;
create policy "Authenticated users can read matchups"
on public.rankd_matchups
for select
to authenticated
using (true);

drop policy if exists "Public can view shareable rankd matchups" on public.rankd_matchups;
create policy "Public can view shareable rankd matchups"
on public.rankd_matchups
for select
to anon
using (is_shareable = true);

drop policy if exists "Authenticated users can insert seasons" on public.seasons;
drop policy if exists "Authenticated users can update seasons" on public.seasons;

drop policy if exists "Manage own show review votes" on public.show_review_votes;
drop policy if exists "Users can view show review votes" on public.show_review_votes;

-- This policy was a stricter permissive INSERT policy alongside a broader
-- permissive owner INSERT policy, so it did not restrict access in practice.
drop policy if exists "Users cannot reply to their own reviews" on public.show_reviews;

drop policy if exists "Authenticated users can insert shows" on public.shows;
drop policy if exists "Authenticated users can update shows" on public.shows;
drop policy if exists "Authenticated can read shows" on public.shows;

drop policy if exists "Users can manage own rankings" on public.user_show_rankings;

commit;
