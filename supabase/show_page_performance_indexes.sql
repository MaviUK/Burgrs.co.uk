-- BURGRS show-page performance indexes
-- Audited against the live BURGRS database on 2026-09-25.
--
-- Existing live indexes already cover:
--   episodes (show_id, season_number, episode_number)
--   shows (tmdb_id)
--   user_shows_new (user_id, show_id)
--   watched_episodes (user_id, episode_id)
--
-- These are the remaining indexes added for current show-page query patterns.

create index if not exists burgr_ratings_show_id_idx
  on public.burgr_ratings (show_id);

create index if not exists episode_ratings_episode_id_idx
  on public.episode_ratings (episode_id);

create index if not exists user_show_rankings_user_ladder_idx
  on public.user_show_rankings (user_id, ladder_position)
  where ladder_position is not null;
