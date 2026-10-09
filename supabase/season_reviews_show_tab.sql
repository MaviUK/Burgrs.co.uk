-- Keep the existing feed post and a linked, interactive show review in sync.
alter table public.show_reviews add column if not exists creator_post_id uuid
  references public.creator_posts(id) on delete set null;
create unique index if not exists show_reviews_creator_post_idx
  on public.show_reviews(creator_post_id);
-- A member has one main review per show; editorial season reviews have one per post.
drop index if exists public.show_reviews_one_main_per_user;
create unique index show_reviews_one_main_per_user on public.show_reviews(show_id, user_id)
  where parent_id is null and creator_post_id is null;

-- Only the server can attach an editorial post; members retain the existing one-review rule.
create or replace function burgrs_integrations.guard_season_review_link()
returns trigger language plpgsql security invoker set search_path='' as $
begin
  if new.creator_post_id is not null and new.parent_id is not null then
    raise exception 'A linked season review must be a main review';
  end if;
  if current_user not in ('postgres','service_role','supabase_admin') then
    if tg_op='INSERT' then
      if new.creator_post_id is not null then raise exception 'Season review links are server-managed'; end if;
    elsif new.creator_post_id is distinct from old.creator_post_id then
      raise exception 'Season review links are server-managed';
    end if;
  end if;
  return new;
end;
$;
revoke all on function burgrs_integrations.guard_season_review_link() from public,anon,authenticated;
grant execute on function burgrs_integrations.guard_season_review_link() to service_role;
drop trigger if exists guard_season_review_link on public.show_reviews;
create trigger guard_season_review_link before insert or update on public.show_reviews
  for each row execute function burgrs_integrations.guard_season_review_link();

create or replace function burgrs_integrations.sync_season_review_show_tab()
returns trigger language plpgsql security invoker set search_path='' as $$
declare post_id uuid; review_id uuid;
begin
  if tg_op='DELETE' then post_id:=old.id; else post_id:=new.id; end if;
  if tg_op<>'DELETE' and new.is_auto_season_review and new.visibility='public'
    and new.related_show_id is not null and length(btrim(new.body))>0
    and exists(select 1 from public.tv_season_review_settings cfg
      join public.profiles p on p.id=cfg.author_id
      where cfg.id and cfg.author_id=new.user_id and p.is_system_admin)
  then
    insert into public.show_reviews(creator_post_id,show_id,user_id,parent_id,body,created_at,updated_at)
    values(new.id,new.related_show_id,new.user_id,null,
      new.title||chr(10)||chr(10)||new.body,new.created_at,new.updated_at)
    on conflict(creator_post_id) do update set
      show_id=excluded.show_id,user_id=excluded.user_id,body=excluded.body,updated_at=excluded.updated_at;
  else
    select id into review_id from public.show_reviews where creator_post_id=post_id;
    if review_id is not null then
      -- Match the existing review deletion behaviour, including its reply thread.
      delete from public.show_reviews where id=review_id;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function burgrs_integrations.sync_season_review_show_tab() from public,anon,authenticated;
grant execute on function burgrs_integrations.sync_season_review_show_tab() to service_role;
drop trigger if exists sync_season_review_show_tab on public.creator_posts;
create trigger sync_season_review_show_tab
  after insert or update of title,body,visibility,related_show_id,is_auto_season_review on public.creator_posts
  for each row execute function burgrs_integrations.sync_season_review_show_tab();
drop trigger if exists remove_season_review_show_tab on public.creator_posts;
create trigger remove_season_review_show_tab before delete on public.creator_posts
  for each row execute function burgrs_integrations.sync_season_review_show_tab();

-- Backfill already published season reviews without changing their feed posts.
insert into public.show_reviews(creator_post_id,show_id,user_id,parent_id,body,created_at,updated_at)
select cp.id,cp.related_show_id,cp.user_id,null,cp.title||chr(10)||chr(10)||cp.body,cp.created_at,cp.updated_at
from public.creator_posts cp join public.tv_season_review_settings cfg on cfg.author_id=cp.user_id and cfg.id
join public.profiles p on p.id=cfg.author_id and p.is_system_admin
where cp.is_auto_season_review and cp.visibility='public' and cp.related_show_id is not null and length(btrim(cp.body))>0
on conflict(creator_post_id) do nothing;
