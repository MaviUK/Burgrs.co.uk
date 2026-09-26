import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/date";
import "./Dashboard.css";

const DASHBOARD_CACHE_PREFIX = "burgrs_dashboard_cache_v14_SMART_UP_NEXT";
const DASHBOARD_CACHE_DURATION = 1000 * 60 * 15;
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
    newsStories: [],
    friendPicks: [],
    stats: {
      totalShows: 0,
      inProgressCount: 0,
      completedCount: 0,
      watchedMinutes: 0,
      upNext: null,
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

function getDayHeading(dateValue) {
  const normalized = normalizeDateOnly(dateValue);
  if (!normalized) return "Coming up";

  const target = new Date(`${normalized}T00:00:00`);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === tomorrow.getTime()) return "Tomorrow";

  return target.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function getPremiereDate(show) {
  return (
    normalizeDateOnly(show?.first_air_date) ||
    normalizeDateOnly(show?.firstAired) ||
    normalizeDateOnly(show?.premiere_date) ||
    normalizeDateOnly(show?.aired_date)
  );
}

function formatPremiereBadge(show) {
  const value = getPremiereDate(show);
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return date
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

function groupUpcomingByDay(items) {
  const groups = [];
  const map = new Map();

  (items || []).forEach((item) => {
    const dateKey = normalizeDateOnly(item?.episode?.aired) || "unknown";
    if (!map.has(dateKey)) {
      const group = { key: dateKey, label: getDayHeading(dateKey), items: [] };
      map.set(dateKey, group);
      groups.push(group);
    }

    const group = map.get(dateKey);
    const showKey = String(item?.show?.show_id || item?.episode?.show_id || "");
    const existing = group.items.find(
      (release) => String(release?.show?.show_id || "") === showKey
    );

    if (existing) {
      existing.episodes.push(item.episode);
      return;
    }

    group.items.push({
      show: item.show,
      episode: item.episode,
      episodes: [item.episode],
    });
  });

  groups.forEach((group) => {
    group.items.forEach((release) => {
      release.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
    });
  });

  return groups;
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

async function fetchLatestNews() {
  try {
    const { data, error } = await supabase
      .from("creator_posts")
      .select("id, title, image_url, source_name, source_url, related_show_id, created_at")
      .eq("is_auto_news", true)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn("Dashboard news fetch failed:", error);
    return [];
  }
}

async function fetchFriendPicks(userId) {
  if (!userId) return [];

  try {
    const { data: followRows, error: followsError } = await supabase
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", userId);

    if (followsError) throw followsError;

    const followingIds = (followRows || [])
      .map((row) => row.following_id)
      .filter(Boolean);

    if (!followingIds.length) return [];

    const { data: ratingRows, error: ratingsError } = await supabase
      .from("burgr_ratings")
      .select("user_id, show_id, rating, updated_at")
      .in("user_id", followingIds)
      .gte("rating", 70)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (ratingsError) throw ratingsError;

    const grouped = new Map();
    (ratingRows || []).forEach((row) => {
      const key = String(row.show_id || "");
      if (!key) return;
      const current = grouped.get(key) || {
        show_id: row.show_id,
        total: 0,
        count: 0,
        latest: 0,
      };
      current.total += Number(row.rating || 0);
      current.count += 1;
      current.latest = Math.max(
        current.latest,
        new Date(row.updated_at || 0).getTime() || 0
      );
      grouped.set(key, current);
    });

    const candidates = Array.from(grouped.values())
      .map((item) => ({
        ...item,
        average: Math.round(item.total / Math.max(1, item.count)),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.average !== a.average) return b.average - a.average;
        return b.latest - a.latest;
      })
      .slice(0, 12);

    if (!candidates.length) return [];

    const { data: shows, error: showsError } = await supabase
      .from("shows")
      .select("id, tvdb_id, tmdb_id, name, poster_url, first_aired")
      .in("id", candidates.map((item) => item.show_id));

    if (showsError) throw showsError;

    const showMap = new Map((shows || []).map((show) => [String(show.id), show]));

    return candidates
      .map((item) => {
        const show = showMap.get(String(item.show_id));
        if (!show) return null;
        return {
          ...show,
          friend_rating: item.average,
          friend_rating_count: item.count,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn("Dashboard friend picks fetch failed:", error);
    return [];
  }
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

  const todayKey = [
    new Date().getFullYear(),
    String(new Date().getMonth() + 1).padStart(2, "0"),
    String(new Date().getDate()).padStart(2, "0"),
  ].join("-");

  const progressByShow = new Map(
    visibleShows.map((show) => {
      const showKey = String(show.show_id);
      const showEpisodes = episodesByShow.get(showKey) || [];
      const airedEpisodes = showEpisodes.filter(
        (episode) => episode.aired && hasAired(episode.aired)
      );
      const watchedCount = airedEpisodes.filter((episode) =>
        watchedIds.has(String(episode.id))
      ).length;

      let lastWatchedIndex = -1;
      airedEpisodes.forEach((episode, index) => {
        if (watchedIds.has(String(episode.id))) {
          lastWatchedIndex = index;
        }
      });

      // Only count unwatched episodes from the user's current position onward.
      // This preserves the existing behaviour for users who intentionally
      // started a show at a later season.
      const relevantAiredEpisodes =
        lastWatchedIndex < 0 ? airedEpisodes : airedEpisodes.slice(lastWatchedIndex + 1);
      const unwatchedFromCurrentPosition = relevantAiredEpisodes.filter(
        (episode) => !watchedIds.has(String(episode.id))
      );
      const olderUnwatched = unwatchedFromCurrentPosition.filter(
        (episode) => normalizeDateOnly(episode.aired) < todayKey
      );
      const releasedToday = unwatchedFromCurrentPosition.filter(
        (episode) => normalizeDateOnly(episode.aired) === todayKey
      );
      const isNewToday = releasedToday.length > 0 && olderUnwatched.length === 0;
      const nextEpisode = isNewToday
        ? releasedToday[0]
        : unwatchedFromCurrentPosition[0] || null;

      return [
        showKey,
        {
          show,
          episode: nextEpisode,
          episodesBehind: unwatchedFromCurrentPosition.length,
          isNewToday,
          watchedCount,
          totalAired: airedEpisodes.length,
          lastWatchedAt: latestWatchedAtByShow.get(showKey) || 0,
          progress: airedEpisodes.length
            ? Math.round((watchedCount / airedEpisodes.length) * 100)
            : 0,
        },
      ];
    })
  );

  const catchUpCandidates = visibleShows
    .filter((show) => normalizeStatus(show.watch_status) === "watching")
    .map((show) => progressByShow.get(String(show.show_id)))
    .filter((item) => item?.episode && item.episodesBehind > 0)
    .sort((a, b) => {
      if (b.lastWatchedAt !== a.lastWatchedAt) return b.lastWatchedAt - a.lastWatchedAt;
      if (a.episodesBehind !== b.episodesBehind) return a.episodesBehind - b.episodesBehind;
      return b.progress - a.progress;
    });

  const newTodayCandidates = catchUpCandidates
    .filter((item) => item.isNewToday)
    .sort((a, b) => {
      if (b.lastWatchedAt !== a.lastWatchedAt) return b.lastWatchedAt - a.lastWatchedAt;
      if (a.episodesBehind !== b.episodesBehind) return a.episodesBehind - b.episodesBehind;
      return String(a.show?.show_name || "").localeCompare(String(b.show?.show_name || ""));
    });

  // A new episode released today from a show that was caught up yesterday wins.
  // Otherwise continue the show the user watched most recently.
  const upNext = newTodayCandidates[0] || catchUpCandidates[0] || null;
  const continueWatching = catchUpCandidates
    .filter(
      (item) =>
        !upNext || String(item.show?.show_id || "") !== String(upNext.show?.show_id || "")
    )
    .slice(0, 8);

  const caughtUpShowIds = new Set(
    visibleShows
      .filter((show) => {
        const progress = progressByShow.get(String(show.show_id));
        return progress && progress.episodesBehind === 0;
      })
      .map((show) => String(show.show_id))
  );

  const airingThisWeek = regularEpisodes
    .filter((episode) => {
      const showKey = String(episode.show_id);
      if (!showsById.has(showKey) || !caughtUpShowIds.has(showKey)) return false;
      if (!episode.aired || !isDateWithinNextDays(episode.aired, 7)) return false;
      return !hasAired(episode.aired) && !watchedIds.has(String(episode.id));
    })
    .sort((a, b) => {
      if (a.aired !== b.aired) return a.aired.localeCompare(b.aired);
      if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
      return a.episodeNumber - b.episodeNumber;
    })
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
    upNext,
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
  const { show, episode, watchedCount, totalAired, progress, episodesBehind } = item;

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
          {episodesBehind
            ? `${episodesBehind} episode${episodesBehind === 1 ? "" : "s"} to catch up`
            : `${watchedCount} of ${totalAired} aired episodes watched`}
        </small>
      </div>
    </Link>
  );
}

function DashboardEpisodeItem({ show, episode, episodes = [] }) {
  if (!show || !episode) return null;

  const releaseEpisodes = episodes.length ? episodes : [episode];
  const firstEpisode = releaseEpisodes[0];
  const lastEpisode = releaseEpisodes[releaseEpisodes.length - 1];
  const isBatchRelease = releaseEpisodes.length > 1;

  let releaseLabel = `${getDisplayEpisodeCode(firstEpisode)} · ${firstEpisode.name || "New episode"}`;

  if (isBatchRelease) {
    const sameSeason = releaseEpisodes.every(
      (item) => item.seasonNumber === firstEpisode.seasonNumber
    );
    const rangeLabel = sameSeason
      ? `S${String(firstEpisode.seasonNumber).padStart(2, "0")}E${String(firstEpisode.episodeNumber).padStart(2, "0")}–E${String(lastEpisode.episodeNumber).padStart(2, "0")}`
      : `${getDisplayEpisodeCode(firstEpisode)}–${getDisplayEpisodeCode(lastEpisode)}`;

    releaseLabel = `${rangeLabel} · ${releaseEpisodes.length} episodes`;
  }

  return (
    <Link to={getSavedShowLink(show)} className="dashboard-list-item dashboard-episode-item">
      <Poster src={show.poster_url} alt="" className="dashboard-list-poster" />
      <div className="dashboard-list-copy">
        <strong>{show.show_name || "Unknown show"}</strong>
        <span>{releaseLabel}</span>
        <small>
          {isBatchRelease ? "Releases" : "Airs"} {formatDate(firstEpisode.aired)}
        </small>
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

function ExternalShowCard({ show, savedShows, databaseShows, showPremiereDate = false }) {
  const linkTarget = getExternalShowLink(show, savedShows, databaseShows);
  const showName = show?.name || show?.title || "Unknown show";
  const imageSrc =
    show?.image ||
    show?.poster_url ||
    show?.posterUrl ||
    show?.image_url ||
    (show?.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : "");
  const premiereBadge = showPremiereDate ? formatPremiereBadge(show) : "";

  const content = (
    <>
      <div className="trending-card-poster-wrap">
        <Poster src={imageSrc} alt={showName} className="trending-card-image" />
        {premiereBadge ? <span className="premiere-date-badge">{premiereBadge}</span> : null}
      </div>
      {showPremiereDate ? <strong className="trending-card-title">{showName}</strong> : null}
    </>
  );

  if (!linkTarget) return <div className="trending-card">{content}</div>;
  return <Link to={linkTarget} className="trending-card">{content}</Link>;
}

function UpNextHero({ item }) {
  if (!item) return null;

  const { show, episode, watchedCount, totalAired, progress, isNewToday } = item;
  const backgroundImage = show.backdrop_url || show.poster_url || "";

  return (
    <Link
      to={getSavedShowLink(show)}
      className="up-next-hero"
      style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")` } : undefined}
    >
      <div className="up-next-shade" />
      <div className="up-next-content">
        <span className="up-next-kicker">
          Up Next{isNewToday ? " · New today" : ""}
        </span>
        <h1>{show.show_name || "Unknown show"}</h1>
        <p>
          <strong>{getDisplayEpisodeCode(episode)}</strong>
          <span> · {episode.name || "Next episode"}</span>
        </p>
        <div className="up-next-progress" aria-label={`${progress}% watched`}>
          <span style={{ width: `${Math.max(3, progress)}%` }} />
        </div>
        <small>{watchedCount} of {totalAired} aired episodes watched</small>
        <span className="up-next-action">View episode <b aria-hidden="true">›</b></span>
      </div>
    </Link>
  );
}

function NewsCard({ story }) {
  const card = (
    <>
      {story.image_url ? (
        <img src={story.image_url} alt="" className="dashboard-news-image" loading="lazy" />
      ) : (
        <div className="dashboard-news-image dashboard-news-image-placeholder">TV</div>
      )}
      <div className="dashboard-news-copy">
        <span>{story.source_name || "TV News"}</span>
        <strong>{story.title || "Latest TV news"}</strong>
      </div>
    </>
  );

  if (story.source_url) {
    return (
      <a
        href={story.source_url}
        target="_blank"
        rel="noreferrer"
        className="dashboard-news-card"
      >
        {card}
      </a>
    );
  }

  if (story.related_show_id) {
    return (
      <Link to={`/show/${story.related_show_id}`} className="dashboard-news-card">
        {card}
      </Link>
    );
  }

  return <div className="dashboard-news-card">{card}</div>;
}

function FriendPickCard({ show }) {
  const href = show.tmdb_id
    ? `/show/tmdb/${show.tmdb_id}`
    : show.tvdb_id
      ? `/show/${show.tvdb_id}`
      : `/show/${show.id}`;

  return (
    <Link to={href} className="friend-pick-card">
      <Poster src={show.poster_url} alt={show.name} className="friend-pick-poster" />
      <strong>{show.name || "Unknown show"}</strong>
      <span>
        {show.friend_rating}% · {show.friend_rating_count} rating
        {show.friend_rating_count === 1 ? "" : "s"}
      </span>
    </Link>
  );
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
          const [trending, premieringSoon, newsStories] = await Promise.all([
            fetchTrendingShows().catch(() => []),
            fetchPremieringSoonShows().catch(() => []),
            fetchLatestNews(),
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
            newsStories,
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
              backdrop_url,
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
          backdrop_url: row.shows?.backdrop_url || null,
          first_aired: row.shows?.first_aired || null,
        }));

        const showIds = normalizedShows
          .filter((show) => !isArchivedStatus(show.watch_status))
          .map((show) => show.show_id)
          .filter(Boolean);

        const [watchedRows, allEpisodes, trending, premieringSoon, newsStories, friendPicks] = await Promise.all([
          showIds.length
            ? fetchWatchedEpisodeRowsForShowIds(user.id, showIds)
            : Promise.resolve([]),
          showIds.length ? fetchEpisodesForShowIds(showIds) : Promise.resolve([]),
          fetchTrendingShows().catch(() => []),
          fetchPremieringSoonShows().catch(() => []),
          fetchLatestNews(),
          fetchFriendPicks(user.id),
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
            backdrop_url: show.backdrop_url,
            watch_status: show.watch_status,
          })),
          databaseShows,
          trendingShows: trending,
          premieringSoonShows: premieringSoon,
          newsStories,
          friendPicks: friendPicks.filter(
            (pick) => !showIds.some((showId) => String(showId) === String(pick.id))
          ),
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
  const newsStories = dashboardView.newsStories || [];
  const friendPicks = dashboardView.friendPicks || [];
  const data = dashboardView.stats || makeEmptyDashboardView().stats;
  const upNext = data.upNext || data.continueWatching?.[0] || null;
  const continueWatching = data.upNext
    ? data.continueWatching || []
    : (data.continueWatching || []).slice(1);
  const upcomingGroups = groupUpcomingByDay(data.airingThisWeek || []);

  if (loading) {
    return (
      <div className="page dashboard-page">
        <p className="dashboard-loading-copy">Loading your BURGRS home...</p>
      </div>
    );
  }

  return (
    <div className="page dashboard-page">
      <form action="/search" method="get" className="dashboard-home-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          name="q"
          placeholder="Search shows, actors, creators..."
          aria-label="Search BURGRS"
        />
        <button type="submit">Search</button>
      </form>

      {dashboardView.isSignedIn && upNext ? (
        <section className="dashboard-personal-section dashboard-up-next-section">
          <UpNextHero item={upNext} />
        </section>
      ) : null}

      {dashboardView.isSignedIn && continueWatching.length > 0 ? (
        <section className="dashboard-personal-section dashboard-continue-section">
          <SectionHeader title="Catch Up" to="/my-shows" />
          <div className="continue-row">
            {continueWatching.map((item) => (
              <ContinueWatchingCard key={`continue-${item.show.show_id}`} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {dashboardView.isSignedIn && upcomingGroups.length > 0 ? (
        <section className="dashboard-personal-section dashboard-this-week-section">
          <SectionHeader title="Upcoming This Week" to="/calendar" linkLabel="Calendar" />
          <div className="dashboard-week-groups">
            {upcomingGroups.map((group) => (
              <div key={group.key} className="dashboard-day-group">
                <h3>{group.label}</h3>
                <div className="dashboard-list dashboard-upcoming-list">
                  {group.items.map(({ show, episode, episodes }) => (
                    <DashboardEpisodeItem
                      key={`${show.show_id}-${group.key}-week`}
                      show={show}
                      episode={episode}
                      episodes={episodes}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {newsStories.length > 0 ? (
        <section className="dashboard-personal-section dashboard-news-section">
          <SectionHeader title="TV News" to="/following" linkLabel="View feed" />
          <div className="dashboard-news-row">
            {newsStories.map((story) => (
              <NewsCard key={story.id} story={story} />
            ))}
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
        <SectionHeader title="Premiering This Week" />
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
                showPremiereDate
              />
            ))}
          </div>
        )}
      </section>

      {dashboardView.isSignedIn && friendPicks.length > 0 ? (
        <section className="dashboard-personal-section dashboard-friend-picks-section">
          <SectionHeader title="Popular With People You Follow" to="/following" />
          <div className="friend-picks-row">
            {friendPicks.map((show) => (
              <FriendPickCard key={`friend-pick-${show.id}`} show={show} />
            ))}
          </div>
        </section>
      ) : null}

      {dashboardView.isSignedIn ? (
        <section className="dashboard-personal-section dashboard-stats-section dashboard-stats-bottom">
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
    </div>
  );
}
