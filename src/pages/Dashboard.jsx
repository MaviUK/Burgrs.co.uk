import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/date";
import "./Dashboard.css";

const DASHBOARD_CACHE_PREFIX = "burgrs_dashboard_cache_v9_LEAN_DATA";
const DASHBOARD_CACHE_DURATION = 1000 * 60 * 60 * 24;
const DASHBOARD_PUBLIC_CACHE_KEY = `${DASHBOARD_CACHE_PREFIX}:public`;

function getDashboardCacheKey(userId) {
  return userId ? `${DASHBOARD_CACHE_PREFIX}:${userId}` : DASHBOARD_PUBLIC_CACHE_KEY;
}

function readDashboardCache(userId) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getDashboardCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || !parsed?.data) return null;
    if (Date.now() - Number(parsed.savedAt) >= DASHBOARD_CACHE_DURATION) return null;
    return parsed.data;
  } catch (error) {
    console.warn("Failed reading dashboard cache:", error);
    return null;
  }
}

function writeDashboardCache(userId, data) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getDashboardCacheKey(userId),
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch (error) {
    console.warn("Failed writing dashboard cache:", error);
  }
}

function makeEmptyDashboardView() {
  return {
    isSignedIn: false,
    savedShows: [],
    databaseShows: [],
    trendingShows: [],
    premieringSoonShows: [],
    stats: {
      totalShows: 0,
      inProgressCount: 0,
      completedCount: 0,
      watchedMinutes: 0,
      continueWatching: [],
      airingThisWeek: [],
      recentlyAdded: [],
    },
  };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isArchivedStatus(value) {
  const status = normalizeStatus(value);
  return status === "archived" || status === "archive";
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isDateWithinNextDays(dateValue, daysAhead = 7) {
  const normalized = normalizeDateOnly(dateValue);
  if (!normalized) return false;

  const today = startOfToday();
  const end = new Date(today);
  end.setDate(end.getDate() + daysAhead);
  const target = new Date(`${normalized}T00:00:00`);
  return target >= today && target <= end;
}

function hasAired(dateValue) {
  const normalized = normalizeDateOnly(dateValue);
  if (!normalized) return false;
  return new Date(`${normalized}T00:00:00`) <= startOfToday();
}

function formatMinutes(totalMinutes) {
  const minutes = Number(totalMinutes) || 0;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return `${days}d ${hours}h ${mins}m`;
}

function getDisplayEpisodeCode(ep) {
  return `S${String(ep.seasonNumber).padStart(2, "0")}E${String(
    ep.episodeNumber
  ).padStart(2, "0")}`;
}

function getSavedShowLink(show) {
  if (!show) return "/my-shows";
  if (show.tvdb_id) return `/my-shows/${show.tvdb_id}`;
  if (show.tmdb_id) return `/my-shows/tmdb/${show.tmdb_id}`;
  return "/my-shows";
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizeEpisode(ep) {
  const seasonNumber = Number(ep.season_number ?? ep.seasonNumber ?? 0);
  const episodeNumber = Number(ep.episode_number ?? ep.episodeNumber ?? 0);

  return {
    id: ep.id,
    show_id: ep.show_id,
    seasonNumber,
    episodeNumber,
    name: ep.name || `Episode ${episodeNumber || ""}`.trim(),
    aired: normalizeDateOnly(ep.aired_date || ep.aired || ep.air_date),
    runtime_minutes: Number(ep.runtime_minutes || 0),
  };
}

async function fetchEpisodesForShowIds(showIds) {
  if (!showIds.length) return [];

  const allEpisodes = [];
  const pageSize = 1000;

  for (const batch of chunkArray(showIds, 40)) {
    let from = 0;
    let done = false;

    while (!done) {
      const { data, error } = await supabase
        .from("episodes")
        .select("id, show_id, season_number, episode_number, name, aired_date, runtime_minutes")
        .in("show_id", batch)
        .gt("season_number", 0)
        .gt("episode_number", 0)
        .order("show_id", { ascending: true })
        .order("season_number", { ascending: true })
        .order("episode_number", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const rows = data || [];
      allEpisodes.push(...rows);
      done = rows.length < pageSize;
      from += pageSize;
    }
  }

  return allEpisodes;
}

async function fetchWatchedEpisodeRowsForShowIds(userId, showIds) {
  if (!userId || !showIds.length) return [];

  const allRows = [];
  const pageSize = 1000;

  for (const batch of chunkArray(showIds, 40)) {
    let from = 0;
    let done = false;

    while (!done) {
      const { data, error } = await supabase
        .from("watched_episodes")
        .select("episode_id, watched_at, episodes!inner(show_id)")
        .eq("user_id", userId)
        .in("episodes.show_id", batch)
        .order("watched_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const rows = data || [];
      allRows.push(
        ...rows.map((row) => ({
          episode_id: row.episode_id,
          watched_at: row.watched_at,
        }))
      );
      done = rows.length < pageSize;
      from += pageSize;
    }
  }

  return allRows;
}

async function fetchTrendingShows() {
  const response = await fetch("/.netlify/functions/getTrendingShows");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Failed to load trending shows");
  return (payload?.shows || []).filter((show) => show?.tmdb_id || show?.tvdb_id);
}

async function fetchPremieringSoonShows() {
  const response = await fetch("/.netlify/functions/getPremieringSoon");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Failed to load premiering soon shows");

  return (payload?.shows || payload?.items || []).filter((show) => {
    const date =
      normalizeDateOnly(show?.first_air_date) ||
      normalizeDateOnly(show?.firstAired) ||
      normalizeDateOnly(show?.premiere_date) ||
      normalizeDateOnly(show?.aired_date);
    return date && isDateWithinNextDays(date, 10);
  });
}

async function fetchDatabaseShowMatches(externalShows) {
  const tmdbIds = Array.from(
    new Set(
      (externalShows || [])
        .map((show) => show?.tmdb_id || show?.id)
        .filter(Boolean)
        .map(String)
    )
  );
  const tvdbIds = Array.from(
    new Set((externalShows || []).map((show) => show?.tvdb_id).filter(Boolean).map(String))
  );

  const queries = [];

  if (tmdbIds.length) {
    queries.push(
      supabase
        .from("shows")
        .select("id, tvdb_id, tmdb_id, name, poster_url")
        .in("tmdb_id", tmdbIds)
    );
  }

  if (tvdbIds.length) {
    queries.push(
      supabase
        .from("shows")
        .select("id, tvdb_id, tmdb_id, name, poster_url")
        .in("tvdb_id", tvdbIds)
    );
  }

  if (!queries.length) return [];

  const results = await Promise.all(queries);
  const rows = [];

  results.forEach(({ data, error }) => {
    if (error) throw error;
    rows.push(...(data || []));
  });

  return Array.from(
    new Map(rows.filter((show) => show?.id).map((show) => [String(show.id), show])).values()
  );
}

function getExternalShowLink(show, savedShows, databaseShows) {
  if (!show) return null;

  const tmdbId = show.tmdb_id || show.id || null;
  const tvdbId = show.tvdb_id || null;

  if (tmdbId) {
    const savedByTmdb = (savedShows || []).find(
      (item) => item.tmdb_id && String(item.tmdb_id) === String(tmdbId)
    );
    if (savedByTmdb) return `/my-shows/tmdb/${tmdbId}`;
  }

  if (tvdbId) {
    const savedByTvdb = (savedShows || []).find(
      (item) => item.tvdb_id && String(item.tvdb_id) === String(tvdbId)
    );
    if (savedByTvdb) return `/my-shows/${tvdbId}`;
  }

  if (tmdbId) {
    const dbByTmdb = (databaseShows || []).find(
      (item) => item.tmdb_id && String(item.tmdb_id) === String(tmdbId)
    );
    if (dbByTmdb) return `/show/tmdb/${tmdbId}`;
  }

  if (tvdbId) {
    const dbByTvdb = (databaseShows || []).find(
      (item) => item.tvdb_id && String(item.tvdb_id) === String(tvdbId)
    );
    if (dbByTvdb) return `/show/${tvdbId}`;
  }

  if (tmdbId) return `/show/tmdb/${tmdbId}`;
  if (tvdbId) return `/show/${tvdbId}`;
  return null;
}

function buildPersonalDashboard(savedShows, episodes, watchedEpisodeRows) {
  const watchedIds = new Set(
    (watchedEpisodeRows || []).map((row) => String(row.episode_id)).filter(Boolean)
  );
  const visibleShows = (savedShows || []).filter((show) => !isArchivedStatus(show.watch_status));
  const showsById = new Map(visibleShows.map((show) => [String(show.show_id), show]));

  // Specials (season 0) are excluded at query time and kept out here as a safety guard.
  const regularEpisodes = (episodes || [])
    .map(normalizeEpisode)
    .filter((episode) => episode.seasonNumber > 0 && episode.episodeNumber > 0)
    .sort((a, b) => {
      if (String(a.show_id) !== String(b.show_id)) {
        return String(a.show_id).localeCompare(String(b.show_id));
      }
      if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
      return a.episodeNumber - b.episodeNumber;
    });

  const episodesByShow = new Map();
  const regularEpisodeById = new Map();
  regularEpisodes.forEach((episode) => {
    const key = String(episode.show_id);
    if (!episodesByShow.has(key)) episodesByShow.set(key, []);
    episodesByShow.get(key).push(episode);
    regularEpisodeById.set(String(episode.id), episode);
  });

  const latestWatchedAtByShow = new Map();
  (watchedEpisodeRows || []).forEach((row) => {
    const episode = regularEpisodeById.get(String(row?.episode_id || ""));
    if (!episode) return;

    const timestamp = new Date(row?.watched_at || 0).getTime() || 0;
    const showKey = String(episode.show_id);
    if (timestamp > (latestWatchedAtByShow.get(showKey) || 0)) {
      latestWatchedAtByShow.set(showKey, timestamp);
    }
  });

  const continueWatching = visibleShows
    .filter((show) => normalizeStatus(show.watch_status) === "watching")
    .map((show) => {
      const showKey = String(show.show_id);
      const showEpisodes = episodesByShow.get(showKey) || [];
      const airedEpisodes = showEpisodes.filter((episode) => episode.aired && hasAired(episode.aired));
      const watchedCount = airedEpisodes.filter((episode) => watchedIds.has(String(episode.id))).length;
      const nextEpisode = airedEpisodes.find((episode) => !watchedIds.has(String(episode.id)));
      if (!nextEpisode) return null;

      return {
        show,
        episode: nextEpisode,
        watchedCount,
        totalAired: airedEpisodes.length,
        lastWatchedAt: latestWatchedAtByShow.get(showKey) || 0,
        progress: airedEpisodes.length
          ? Math.round((watchedCount / airedEpisodes.length) * 100)
          : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.lastWatchedAt !== a.lastWatchedAt) return b.lastWatchedAt - a.lastWatchedAt;
      return b.progress - a.progress;
    })
    .slice(0, 8);

  const airingThisWeek = regularEpisodes
    .filter((episode) => {
      if (!showsById.has(String(episode.show_id))) return false;
      if (!episode.aired || !isDateWithinNextDays(episode.aired, 7)) return false;
      return !watchedIds.has(String(episode.id));
    })
    .sort((a, b) => {
      if (a.aired !== b.aired) return a.aired.localeCompare(b.aired);
      if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
      return a.episodeNumber - b.episodeNumber;
    })
    .slice(0, 8)
    .map((episode) => ({ show: showsById.get(String(episode.show_id)), episode }));

  const recentlyAdded = [...visibleShows]
    .sort((a, b) => {
      const aTime = new Date(a.added_at || a.created_at || 0).getTime() || 0;
      const bTime = new Date(b.added_at || b.created_at || 0).getTime() || 0;
      return bTime - aTime;
    })
    .slice(0, 8);

  const watchedMinutes = regularEpisodes.reduce((total, episode) => {
    if (!watchedIds.has(String(episode.id))) return total;
    return total + Number(episode.runtime_minutes || 0);
  }, 0);

  return {
    totalShows: visibleShows.length,
    inProgressCount: visibleShows.filter(
      (show) => normalizeStatus(show.watch_status) === "watching"
    ).length,
    completedCount: visibleShows.filter(
      (show) => normalizeStatus(show.watch_status) === "completed"
    ).length,
    watchedMinutes,
    continueWatching,
    airingThisWeek,
    recentlyAdded,
  };
}

function SectionHeader({ title, to, linkLabel = "View all" }) {
  return (
    <div className="card-header dashboard-section-header">
      <h2>{title}</h2>
      {to ? (
        <Link to={to} className="dashboard-section-link">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

function Poster({ src, alt, className }) {
  if (!src) return <div className={`${className} dashboard-poster-placeholder`}>?</div>;
  return <img src={src} alt={alt || ""} className={className} loading="lazy" decoding="async" />;
}

function ContinueWatchingCard({ item }) {
  const { show, episode, watchedCount, totalAired, progress } = item;

  return (
    <Link to={getSavedShowLink(show)} className="continue-card">
      <Poster src={show.poster_url} alt={show.show_name} className="continue-card-poster" />
      <div className="continue-card-copy">
        <strong>{show.show_name || "Unknown show"}</strong>
        <span>
          {getDisplayEpisodeCode(episode)} · {episode.name || "Next episode"}
        </span>
        <div className="continue-progress" aria-label={`${progress}% watched`}>
          <span style={{ width: `${Math.max(3, progress)}%` }} />
        </div>
        <small>
          {watchedCount} of {totalAired} aired episodes watched
        </small>
      </div>
    </Link>
  );
}

function DashboardEpisodeItem({ show, episode }) {
  if (!show || !episode) return null;

  return (
    <Link to={getSavedShowLink(show)} className="dashboard-list-item dashboard-episode-item">
      <Poster src={show.poster_url} alt="" className="dashboard-list-poster" />
      <div className="dashboard-list-copy">
        <strong>{show.show_name || "Unknown show"}</strong>
        <span>
          {getDisplayEpisodeCode(episode)} · {episode.name || "New episode"}
        </span>
        <small>Airs {formatDate(episode.aired)}</small>
      </div>
      <span className="dashboard-list-chevron" aria-hidden="true">›</span>
    </Link>
  );
}

function RecentShowCard({ show }) {
  return (
    <Link to={getSavedShowLink(show)} className="recent-show-card">
      <Poster src={show.poster_url} alt={show.show_name} className="recent-show-poster" />
      <strong>{show.show_name || "Unknown show"}</strong>
    </Link>
  );
}

function ExternalShowCard({ show, savedShows, databaseShows }) {
  const linkTarget = getExternalShowLink(show, savedShows, databaseShows);
  const showName = show?.name || show?.title || "Unknown show";
  const imageSrc =
    show?.image ||
    show?.poster_url ||
    show?.posterUrl ||
    show?.image_url ||
    (show?.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : "");

  const content = <Poster src={imageSrc} alt={showName} className="trending-card-image" />;
  if (!linkTarget) return <div className="trending-card">{content}</div>;
  return <Link to={linkTarget} className="trending-card">{content}</Link>;
}

function StatCard({ label, value, to = null }) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </>
  );

  return to ? (
    <Link to={to} className="stat-card stat-card-link">{content}</Link>
  ) : (
    <div className="stat-card">{content}</div>
  );
}

export default function Dashboard() {
  const [dashboardView, setDashboardView] = useState(() => makeEmptyDashboardView());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      let hadCache = false;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user || null;
        const cached = readDashboardCache(user?.id || null);

        if (cached) {
          hadCache = true;
          if (!cancelled) {
            setDashboardView(cached);
            setLoading(false);
          }
        } else if (!cancelled) {
          setDashboardView(makeEmptyDashboardView());
          setLoading(true);
        }

        if (!user) {
          const [trending, premieringSoon] = await Promise.all([
            fetchTrendingShows().catch(() => []),
            fetchPremieringSoonShows().catch(() => []),
          ]);
          const databaseShows = await fetchDatabaseShowMatches([
            ...trending,
            ...premieringSoon,
          ]).catch(() => []);

          const publicView = {
            ...makeEmptyDashboardView(),
            databaseShows,
            trendingShows: trending,
            premieringSoonShows: premieringSoon,
          };

          writeDashboardCache(null, publicView);
          if (!cancelled) setDashboardView(publicView);
          return;
        }

        const { data: showRows, error: showsError } = await supabase
          .from("user_shows_new")
          .select(`
            id,
            user_id,
            show_id,
            watch_status,
            archived_at,
            added_at,
            created_at,
            shows!inner(
              id,
              tvdb_id,
              tmdb_id,
              name,
              status,
              poster_url,
              first_aired
            )
          `)
          .eq("user_id", user.id);

        if (showsError) throw showsError;

        const normalizedShows = (showRows || []).map((row) => ({
          id: row.id,
          user_id: row.user_id,
          show_id: row.show_id,
          watch_status: row.watch_status || "watching",
          archived_at: row.archived_at || null,
          added_at: row.added_at || null,
          created_at: row.created_at || null,
          tvdb_id: row.shows?.tvdb_id || null,
          tmdb_id: row.shows?.tmdb_id || null,
          show_name: row.shows?.name || "Unknown title",
          status: row.shows?.status || null,
          poster_url: row.shows?.poster_url || null,
          first_aired: row.shows?.first_aired || null,
        }));

        const showIds = normalizedShows
          .filter((show) => !isArchivedStatus(show.watch_status))
          .map((show) => show.show_id)
          .filter(Boolean);

        const [watchedRows, allEpisodes, trending, premieringSoon] = await Promise.all([
          showIds.length
            ? fetchWatchedEpisodeRowsForShowIds(user.id, showIds)
            : Promise.resolve([]),
          showIds.length ? fetchEpisodesForShowIds(showIds) : Promise.resolve([]),
          fetchTrendingShows().catch(() => []),
          fetchPremieringSoonShows().catch(() => []),
        ]);

        const databaseShows = await fetchDatabaseShowMatches([
          ...trending,
          ...premieringSoon,
        ]).catch(() => []);

        const freshView = {
          isSignedIn: true,
          savedShows: normalizedShows.map((show) => ({
            show_id: show.show_id,
            tvdb_id: show.tvdb_id,
            tmdb_id: show.tmdb_id,
            show_name: show.show_name,
            poster_url: show.poster_url,
            watch_status: show.watch_status,
          })),
          databaseShows,
          trendingShows: trending,
          premieringSoonShows: premieringSoon,
          stats: buildPersonalDashboard(normalizedShows, allEpisodes, watchedRows),
        };

        writeDashboardCache(user.id, freshView);
        if (!cancelled) setDashboardView(freshView);
      } catch (error) {
        console.error("Error loading dashboard:", error);
        if (!cancelled && !hadCache) setDashboardView(makeEmptyDashboardView());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const savedShows = dashboardView.savedShows || [];
  const databaseShows = dashboardView.databaseShows || [];
  const trendingShows = dashboardView.trendingShows || [];
  const premieringSoonShows = dashboardView.premieringSoonShows || [];
  const data = dashboardView.stats || makeEmptyDashboardView().stats;

  if (loading) {
    return (
      <div className="page dashboard-page">
        <p className="dashboard-loading-copy">Loading your BURGRS home...</p>
      </div>
    );
  }

  return (
    <div className="page dashboard-page">
      {dashboardView.isSignedIn && data.continueWatching.length > 0 ? (
        <section className="dashboard-personal-section dashboard-continue-section">
          <SectionHeader title="Continue Watching" to="/my-shows" />
          <div className="continue-row">
            {data.continueWatching.map((item) => (
              <ContinueWatchingCard key={`continue-${item.show.show_id}`} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {dashboardView.isSignedIn && data.airingThisWeek.length > 0 ? (
        <section className="dashboard-personal-section">
          <SectionHeader title="Coming Up From My Shows" />
          <div className="dashboard-list dashboard-upcoming-list">
            {data.airingThisWeek.map(({ show, episode }) => (
              <DashboardEpisodeItem
                key={`${show.show_id}-${episode.id}-week`}
                show={show}
                episode={episode}
              />
            ))}
          </div>
        </section>
      ) : null}

      {dashboardView.isSignedIn && data.recentlyAdded.length > 0 ? (
        <section className="dashboard-personal-section">
          <SectionHeader title="Recently Added" to="/my-shows" />
          <div className="recent-shows-row">
            {data.recentlyAdded.map((show) => (
              <RecentShowCard key={`recent-${show.show_id}`} show={show} />
            ))}
          </div>
        </section>
      ) : null}

      {dashboardView.isSignedIn ? (
        <section className="dashboard-personal-section dashboard-stats-section">
          <SectionHeader title="Your Stats" />
          <div className="stats-scroll-row">
            <div className="stats-grid">
              <StatCard label="Total Shows" value={data.totalShows} to="/my-shows" />
              <StatCard label="In Progress" value={data.inProgressCount} />
              <StatCard label="Completed" value={data.completedCount} />
              <StatCard label="Time Watched" value={formatMinutes(data.watchedMinutes)} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="trending-section dashboard-discovery-section">
        <SectionHeader title="Trending Shows" />
        {trendingShows.length === 0 ? (
          <p className="empty-state">No trending shows available right now.</p>
        ) : (
          <div className="trending-row">
            {trendingShows.map((show) => (
              <ExternalShowCard
                key={`trending-${show.tmdb_id || show.tvdb_id || show.id}`}
                show={show}
                savedShows={savedShows}
                databaseShows={databaseShows}
              />
            ))}
          </div>
        )}
      </section>

      <section className="trending-section dashboard-discovery-section">
        <SectionHeader title="Premiering Soon" />
        {premieringSoonShows.length === 0 ? (
          <p className="empty-state">No new shows premiering soon.</p>
        ) : (
          <div className="trending-row">
            {premieringSoonShows.map((show) => (
              <ExternalShowCard
                key={`premiering-${show.tmdb_id || show.tvdb_id || show.id}`}
                show={show}
                savedShows={savedShows}
                databaseShows={databaseShows}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
