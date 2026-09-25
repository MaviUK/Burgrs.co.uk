-- BURGRS show-page performance indexes
-- Prepared from the current client query patterns.
--
-- Safe to run repeatedly: every index uses IF NOT EXISTS.
-- The existing UNIQUE indexes used by ON CONFLICT are intentionally not duplicated.

-- Primary show-page episode lookup:
--   WHERE show_id = ? ORDER BY season_number, episode_number
create index if not exists episodes_show_season_episode_idx
  on public.episodes (show_id, season_number, episode_number);

-- Public/TMDB fallback show lookup.
-- TVDB already has a UNIQUE constraint because the app upserts ON CONFLICT (tvdb_id).
create index if not exists shows_tmdb_id_idx
  on public.shows (tmdb_id)
  where tmdb_id is not null;

-- Saved-show BURGR rating lookup:
--   WHERE show_id = ?
-- The existing (user_id, show_id) uniqueness does not efficiently cover show_id alone.
create index if not exists burgr_ratings_show_id_idx
  on public.burgr_ratings (show_id);

-- Episode community rating lookup:
--   WHERE episode_id IN (...)
-- The existing (user_id, episode_id) uniqueness does not efficiently cover episode_id alone.
create index if not exists episode_ratings_episode_id_idx
  on public.episode_ratings (episode_id);

-- Rank'd creator/profile lists:
--   WHERE user_id = ? AND ladder_position IS NOT NULL
--   ORDER BY ladder_position
create index if not exists user_show_rankings_user_ladder_idx
  on public.user_show_rankings (user_id, ladder_position)
  where ladder_position is not null;

-- Optional verification queries after applying this file:
--
-- select
--   schemaname,
--   tablename,
--   indexname,
--   indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and indexname in (
--     'episodes_show_season_episode_idx',
--     'shows_tmdb_id_idx',
--     'burgr_ratings_show_id_idx',
--     'episode_ratings_episode_id_idx',
--     'user_show_rankings_user_ladder_idx'
--   )
-- order by tablename, indexname;
--
-- select relname, seq_scan, idx_scan, n_live_tup
-- from pg_stat_user_tables
-- where schemaname = 'public'
--   and relname in (
--     'shows',
--     'episodes',
--     'burgr_ratings',
--     'episode_ratings',
--     'user_show_rankings'
--   )
-- order by relname;
