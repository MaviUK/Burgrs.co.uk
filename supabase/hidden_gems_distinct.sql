-- Purpose: Surface genuinely less-visible shows instead of duplicating
-- the mainstream For You recommendations. Source of truth is the live RPC.
-- The Dashboard also removes cross-section duplicates at render time.
CREATE OR REPLACE FUNCTION public.get_hidden_gems(p_user_id uuid, p_limit integer DEFAULT 12)
 RETURNS TABLE(show_id uuid, name text, poster_url text, backdrop_url text, first_aired date, status text, tmdb_id bigint, tvdb_id bigint, recommendation_score integer, reason text, quality_rating integer, genre_fit integer, tmdb_vote_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with
system_account as (
  select public.get_system_admin_profile_id() as id
),
my_seen as (
  select distinct us.show_id
  from public.user_shows_new us
  where us.user_id = p_user_id
),
my_rated as (
  select distinct br.show_id
  from public.burgr_ratings br
  where br.user_id = p_user_id
),
dismissed as (
  select rf.show_id
  from public.recommendation_feedback rf
  where rf.user_id = p_user_id
    and rf.feedback_type in ('not_interested', 'less_like')
),
genre_preferences as (
  select
    g.genre,
    avg(br.rating)::numeric as avg_rating,
    count(*)::integer as rating_count
  from public.burgr_ratings br
  join public.shows s on s.id = br.show_id
  cross join lateral unnest(coalesce(s.genres, '{}'::text[])) as g(genre)
  where br.user_id = p_user_id
  group by g.genre
  having count(*) >= 2
),
feedback_genres as (
  select
    g.genre,
    sum(
      case rf.feedback_type
        when 'more_like' then 1.0
        when 'added' then 1.5
        when 'less_like' then -1.0
        else 0
      end
    )::numeric as signal
  from public.recommendation_feedback rf
  join public.shows s on s.id = rf.show_id
  cross join lateral unnest(coalesce(s.genres, '{}'::text[])) as g(genre)
  where rf.user_id = p_user_id
    and rf.feedback_type in ('more_like','less_like','added')
  group by g.genre
),
candidates as (
  select
    s.id as show_id,
    s.name,
    s.poster_url,
    s.backdrop_url,
    s.first_aired,
    s.status,
    s.tmdb_id,
    s.tvdb_id,
    s.tmdb_vote_count,
    br.rating::integer as quality_rating,
    gf.genre_fit,
    gf.top_genre,
    fb.feedback_adjustment,
    -- Missing TMDB votes are unknown, not zero-popularity proof.
    -- TVDB's stored score is a popularity signal, not a 0-10 rating.
    case
      when s.tmdb_vote_count between 20 and 250 then 5
      when s.tmdb_vote_count between 251 and 750 then 4
      when s.tmdb_vote_count between 751 and 1800 then 2
      when coalesce(s.tmdb_vote_count, 0) = 0 and s.rating_average <= 3000 then 5
      when coalesce(s.tmdb_vote_count, 0) = 0 and s.rating_average <= 10000 then 3
      when coalesce(s.tmdb_vote_count, 0) = 0 then 1
      else 0
    end as rarity_bonus
  from public.burgr_ratings br
  join system_account sa on br.user_id = sa.id
  join public.shows s on s.id = br.show_id
  left join lateral (
    select
      round(avg(gp.avg_rating))::integer as genre_fit,
      (array_agg(gp.genre order by gp.avg_rating desc, gp.rating_count desc))[1] as top_genre
    from unnest(coalesce(s.genres, '{}'::text[])) as sg(genre)
    join genre_preferences gp on gp.genre = sg.genre
  ) gf on true
  left join lateral (
    select
      greatest(-15, least(15, round(avg(fg.signal) * 6)))::integer as feedback_adjustment
    from unnest(coalesce(s.genres, '{}'::text[])) as sg(genre)
    join feedback_genres fg on fg.genre = sg.genre
  ) fb on true
  where br.rating >= 75
    and s.poster_url is not null
    -- Both measures must indicate lower visibility when available.
    -- Without TMDB votes, use a conservative TVDB popularity cutoff.
    and (
      (s.tmdb_vote_count between 20 and 1800
        and s.rating_average between 1 and 35000)
      or (coalesce(s.tmdb_vote_count, 0) = 0
        and s.rating_average between 1 and 15000)
    )
    and not exists (select 1 from my_seen ms where ms.show_id = s.id)
    and not exists (select 1 from my_rated mr where mr.show_id = s.id)
    and not exists (select 1 from dismissed d where d.show_id = s.id)
),
scored as (
  select
    c.*,
    least(
      100,
      greatest(
        0,
        round(
          (
            c.quality_rating * 45.0 +
            coalesce(c.genre_fit, c.quality_rating) * 55.0
          ) / 100.0
          + c.rarity_bonus
          + coalesce(c.feedback_adjustment, 0)
        )
      )
    )::integer as recommendation_score
  from candidates c
)
select
  s.show_id,
  s.name,
  s.poster_url,
  s.backdrop_url,
  s.first_aired,
  s.status,
  s.tmdb_id,
  s.tvdb_id,
  s.recommendation_score,
  case
    when s.top_genre is not null and coalesce(s.tmdb_vote_count, 0) <= 2000
      then 'A highly rated ' || s.top_genre || ' hidden gem'
    when s.top_genre is not null
      then 'A lesser-known show that matches your ' || s.top_genre || ' taste'
    else
      'Highly rated but still under the radar'
  end as reason,
  s.quality_rating,
  s.genre_fit,
  s.tmdb_vote_count
from scored s
order by
  (s.genre_fit >= 75) desc nulls last,
  s.recommendation_score desc,
  s.quality_rating desc,
  s.name asc
limit greatest(1, least(coalesce(p_limit, 12), 48));
$function$
