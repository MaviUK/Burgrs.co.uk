-- Publication alerts for all main show reviews, including Burgrs TV season reviews.
alter table public.notification_preferences add column new_review boolean not null default true;
-- Preserve existing news opt-outs, including members who turned all alerts off.
update public.notification_preferences set new_review=coalesce(tv_news,true);

alter table public.show_reviews add column notification_processed_at timestamptz;
-- Start from now; include today's two missed editorial reviews only.
update public.show_reviews r set notification_processed_at=now()
where not (
  r.parent_id is null and r.created_at >= date_trunc('day',now() at time zone 'Europe/London') at time zone 'Europe/London'
  and exists(select 1 from public.creator_posts cp where cp.id=r.creator_post_id
    and cp.is_auto_season_review and cp.visibility='public')
);
create index show_reviews_pending_notification_idx on public.show_reviews(created_at,id)
  where parent_id is null and notification_processed_at is null;

CREATE OR REPLACE FUNCTION burgrs_private.notification_type_enabled(p_user_id uuid, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(
    (
      select case p_type
        when 'follow' then np.follow
        when 'new_review' then np.new_review
        when 'review_reply' then np.review_reply
        when 'chat_reply' then np.chat_reply
        when 'creator_post_comment' then np.creator_post_comment
        when 'creator_list_comment' then np.creator_list_comment
        when 'airing_today' then np.airing_today
        when 'new_season' then np.new_season
        when 'season_premiere_date' then np.season_premiere_date
        when 'for_you_recommendation' then np.for_you_recommendations
        when 'tv_news' then np.tv_news
        when 'show_platform_change' then np.show_platform_changes
        else true
      end
      from public.notification_preferences np
      where np.user_id = p_user_id
    ),
    true
  );
$function$;

CREATE OR REPLACE FUNCTION burgrs_integrations.guard_season_review_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.creator_post_id is not null and new.parent_id is not null then
    raise exception 'A linked season review must be a main review';
  end if;
  if current_user not in ('postgres','service_role','supabase_admin') then
    if tg_op='INSERT' then
      if new.notification_processed_at is not null then raise exception 'Review delivery state is server-managed'; end if;
      if new.creator_post_id is not null then raise exception 'Season review links are server-managed'; end if;
    elsif new.notification_processed_at is distinct from old.notification_processed_at then
      raise exception 'Review delivery state is server-managed';
    elsif new.creator_post_id is distinct from old.creator_post_id then
      raise exception 'Season review links are server-managed';
    end if;
  end if;
  return new;
end;
$function$;


create function public.process_review_notifications()
returns table(notification_id uuid,recipient_user_id uuid,notification_type text,
  notification_title text,notification_body text,notification_url text)
language plpgsql security invoker set search_path='' as $$
declare reviewed record; destination text; author_name text; preview text;
begin
  for reviewed in
    select r.id,r.show_id,r.user_id,r.body,r.created_at,sh.name,sh.tmdb_id,sh.tvdb_id,
      p.display_name,p.full_name,p.username,cp.title editorial_title
    from public.show_reviews r
    join public.shows sh on sh.id=r.show_id
    join public.profiles p on p.id=r.user_id
    left join public.creator_posts cp on cp.id=r.creator_post_id
    where r.parent_id is null and r.notification_processed_at is null
    order by r.created_at,r.id limit 50 for update of r skip locked
  loop
    destination := case
      when reviewed.tmdb_id is not null then '/my-shows/tmdb/'||reviewed.tmdb_id::text
      when reviewed.tvdb_id is not null then '/my-shows/'||reviewed.tvdb_id::text
      else '/show/'||reviewed.show_id::text end
      ||'?tab=reviews&notificationType=new_review&notificationTarget='||reviewed.id::text;
    author_name := coalesce(nullif(reviewed.display_name,''),nullif(reviewed.full_name,''),nullif(reviewed.username,''),'Someone');
    preview := case when reviewed.editorial_title is not null
      then regexp_replace(reviewed.editorial_title,'^.*[—–][[:space:]]*Season[[:space:]]+[0-9]+:[[:space:]]*','')
      else left(regexp_replace(reviewed.body,'[[:space:]]+',' ','g'),160) end;
    return query
      insert into public.notifications as n(recipient_user_id,actor_user_id,type,title,body,url,entity_table,entity_id,meta)
      select distinct us.user_id,reviewed.user_id,'new_review',reviewed.name,
        author_name||' published a review'||chr(10)||preview,
        destination,'show_reviews',reviewed.id,
        jsonb_build_object('event_key','review-published:'||reviewed.id::text,'show_id',reviewed.show_id,'review_id',reviewed.id)
      from public.user_shows_new us
      where us.show_id=reviewed.show_id and us.archived_at is null
        and coalesce(us.added_at,us.created_at)<=reviewed.created_at
        and us.user_id<>reviewed.user_id
        and burgrs_private.notification_type_enabled(us.user_id,'new_review')
      on conflict do nothing
      returning n.id,n.recipient_user_id,n.type,n.title,n.body,n.url;
    update public.show_reviews r set notification_processed_at=now() where r.id=reviewed.id;
  end loop;
end;
$$;
revoke all on function public.process_review_notifications() from public,anon,authenticated;
grant execute on function public.process_review_notifications() to service_role;
