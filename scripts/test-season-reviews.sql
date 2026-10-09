-- Run through a privileged SQL connection. Everything, including Buffer entries,
-- is rolled back. Raises an exception on any regression.
begin;
do $$
declare sh uuid; se uuid; j uuid; token uuid:=gen_random_uuid(); p uuid; again uuid; c record; n integer;
begin
 select us.show_id into sh from public.user_shows_new us join public.tv_season_review_settings cfg on cfg.author_id=us.user_id where us.archived_at is null limit 1;
 insert into public.seasons(show_id,season_number,season_type,episode_count,name) values(sh,9000,'official',2,'Season review transaction test') returning id into se;
 insert into public.episodes(show_id,season_id,season_number,episode_number,name,aired_date,aired_at,is_finale)
 values(sh,se,9000,1,'Test one',current_date-8,(current_date-8)::timestamptz+interval '12 hours',false),
 (sh,se,9000,2,'Test finale',current_date-2,(current_date-2)::timestamptz+interval '12 hours',true);
 update public.tv_season_review_settings set enabled=true,initialized_at=now()-interval '10 days' where id;
 select * into c from public.season_review_candidates() where season_id=se;
 if c.season_id is null or c.release_mode<>'weekly' or c.eligible_at-c.finale_at<>interval '24 hours' then raise exception 'Weekly delay failed'; end if;
 update public.seasons set episode_count=4 where id=se;
 if exists(select 1 from public.season_review_candidates() where season_id=se) then raise exception 'Incomplete episode count admitted'; end if;
 update public.seasons set episode_count=2 where id=se;
 update public.episodes set aired_date=current_date+1 where season_id=se and episode_number=1;
 if exists(select 1 from public.season_review_candidates() where season_id=se) then raise exception 'Future episode admitted'; end if;
 update public.episodes set aired_date=null where season_id=se and episode_number=1;
 if exists(select 1 from public.season_review_candidates() where season_id=se) then raise exception 'Undated episode admitted'; end if;
 update public.episodes set aired_date=current_date-2,aired_at=(current_date-2)::timestamptz+interval '12 hours' where season_id=se and episode_number=1;
 select * into c from public.season_review_candidates() where season_id=se;
 if c.release_mode<>'binge' or c.eligible_at-c.finale_at<>interval '168 hours' then raise exception 'Binge delay failed'; end if;
 update public.episodes set aired_date=current_date-8,aired_at=(current_date-8)::timestamptz+interval '12 hours' where season_id=se and episode_number=1;
 update public.tv_season_review_settings set initialized_at=now() where id;
 if exists(select 1 from public.season_review_candidates() where season_id=se) then raise exception 'Historical backlog admitted'; end if;
 update public.tv_season_review_settings set initialized_at=now()-interval '10 days' where id;
 perform public.season_review_enqueue(); perform public.season_review_enqueue();
 select count(*),min(id::text)::uuid into n,j from public.tv_season_reviews where season_id=se;
 if n<>1 then raise exception 'Duplicate enqueue'; end if;
 update public.tv_season_reviews set step='publish',verification='{"approved":true}'::jsonb where id=j;
 perform public.season_review_claim(token);
 if not exists(select 1 from public.tv_season_reviews where id=j and status='processing' and lock_token=token) then raise exception 'Lease claim failed'; end if;
 if exists(select 1 from public.season_review_claim(gen_random_uuid()) where id=j) then raise exception 'Concurrent lease duplicated'; end if;
 begin
   perform public.season_review_publish(j,gen_random_uuid(),'Transaction test review',repeat('AI-generated test body. ',30));
   raise exception 'Wrong token accepted';
 exception when others then if sqlerrm='Wrong token accepted' then raise; end if; end;
 update public.tv_season_reviews set eligible_at=now()+interval '24 hours' where id=j;
 begin
   perform public.season_review_publish(j,token,'Transaction test review',repeat('AI-generated test body. ',30));
   raise exception 'Early publication accepted';
 exception when others then if sqlerrm='Early publication accepted' then raise; end if; end;
 update public.tv_season_reviews set eligible_at=now()-interval '1 hour' where id=j;
 p:=public.season_review_publish(j,token,'Transaction test review',repeat('AI-generated test body. ',30));
 again:=public.season_review_publish(j,token,'Duplicate transaction test',repeat('AI-generated duplicate. ',30));
 if p is null or again<>p then raise exception 'Publish not idempotent'; end if;
 if not exists(select 1 from public.creator_posts where id=p and is_auto_season_review and not is_auto_news and related_show_id=sh and visibility='public') then raise exception 'Review post metadata invalid'; end if;
 if not exists(select 1 from public.buffer_x_outbox where post_id=p) then raise exception 'Buffer integration failed'; end if;
 if has_table_privilege('anon','public.tv_season_reviews','SELECT') or has_table_privilege('authenticated','public.tv_season_review_settings','UPDATE') or has_function_privilege('anon','public.season_review_publish(uuid,uuid,text,text)','EXECUTE') then raise exception 'Backend access exposed'; end if;
end;
$$;
rollback;
select 'All season review transaction assertions passed; no posts or fixtures saved' as result;
