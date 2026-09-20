import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getShowStatus } from "../lib/showStatus";


const MY_SHOWS_CACHE_PREFIX = "trackt_my_shows_cache_v1";
const MY_SHOWS_CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours
const MY_SHOWS_LAST_CACHE_KEY = `${MY_SHOWS_CACHE_PREFIX}:last`;
const EPISODE_SHOW_BATCH_SIZE = 25;
const EPISODE_FETCH_CONCURRENCY = 4;

function getMyShowsCacheKey(userId) {
  return `${MY_SHOWS_CACHE_PREFIX}:${userId}`;
}

function readLastMyShowsCache() {
  if (typeof window === "undefined") return null;

  try {
    const lastKey = window.localStorage.getItem(MY_SHOWS_LAST_CACHE_KEY);
    if (!lastKey) return null;

    const raw = window.localStorage.getItem(lastKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || !Array.isArray(parsed?.shows)) return null;

    if (Date.now() - Number(parsed.savedAt) > MY_SHOWS_CACHE_DURATION) {
      return null;
    }

    return parsed.shows;
  } catch (error) {
    console.warn("Failed reading last My Shows cache:", error);
    return null;
  }
}

function readMyShowsCache(userId) {
  if (typeof window === "undefined" || !userId) return null;

  try {
    const raw = window.localStorage.getItem(getMyShowsCacheKey(userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || !Array.isArray(parsed?.shows)) return null;

    if (Date.now() - Number(parsed.savedAt) > MY_SHOWS_CACHE_DURATION) {
      return null;
    }

    return parsed.shows;
  } catch (error) {
    console.warn("Failed reading My Shows cache:", error);
    return null;
  }
}

function writeMyShowsCache(userId, shows) {
  if (typeof window === "undefined" || !userId) return;

  try {
    const cacheKey = getMyShowsCacheKey(userId);

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        savedAt: Date.now(),
        shows,
      })
    );
    window.localStorage.setItem(MY_SHOWS_LAST_CACHE_KEY, cacheKey);
  } catch (error) {
    console.warn("Failed writing My Shows cache:", error);
  }
}

function isAired(dateValue) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return date <= new Date();
}

function toStatusEpisodeShape(ep) {
  return {
    seasonNumber: ep.season_number,
    number: ep.episode_number,
    aired: ep.aired_date,
    airDate: ep.aired_date,
    name: ep.name,
  };
}

function daysUntil(dateValue) {
  if (!dateValue) return null;

  const now = new Date();
  const target = new Date(dateValue);

  if (Number.isNaN(target.getTime())) return null;

  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );

  return Math.ceil((targetStart - nowStart) / 86400000);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getPreferredShowName(showRow) {
  return (
    showRow?.english_name ||
    showRow?.name_eng ||
    showRow?.english_title ||
    showRow?.name ||
    "Unknown title"
  );
}

async function fetchEpisodeBatch(showIds) {
  const allEpisodes = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("episodes")
      .select(`
        id,
        show_id,
        season_number,
        episode_number,
        name,
        aired_date
      `)
      .in("show_id", showIds)
      .order("show_id", { ascending: true })
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = data || [];
    allEpisodes.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allEpisodes;
}

async function fetchEpisodesForShowIds(showIds) {
  if (!showIds.length) return [];

  const batches = chunkArray(showIds, EPISODE_SHOW_BATCH_SIZE);
  const allEpisodes = [];

  for (let i = 0; i < batches.length; i += EPISODE_FETCH_CONCURRENCY) {
    const batchGroup = batches.slice(i, i + EPISODE_FETCH_CONCURRENCY);
    const groupResults = await Promise.all(
      batchGroup.map((batch) => fetchEpisodeBatch(batch))
    );

    for (const rows of groupResults) {
      allEpisodes.push(...rows);
    }
  }

  return allEpisodes;
}

async function fetchAllWatchedEpisodeRows(userId) {
  const pageSize = 1000;
  let from = 0;
  let done = false;
  const allRows = [];

  while (!done) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("watched_episodes")
      .select("episode_id")
      .eq("user_id", userId)
      .range(from, to);

    if (error) throw error;

    const rows = data || [];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      done = true;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

function MyShowsLoading({ isMobile }) {
  const skeletonItems = Array.from({ length: isMobile ? 20 : 15 });

  return (
    <div className="page my-shows-page my-shows-loading-page">
      <style>{`
        @keyframes my-shows-loader-shimmer {
          100% { background-position: calc(100% + 180px) 0, 0 0; }
        }

        @keyframes my-shows-loader-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>

      <div
        style={{
          border: "1px solid rgba(148, 163, 184, 0.16)",
          borderRadius: 24,
          padding: isMobile ? "18px 14px" : 22,
          margin: "0 0 16px",
          background:
            "radial-gradient(circle at 50% 0%, rgba(139, 92, 246, 0.26), transparent 52%), linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.66))",
          boxShadow: "0 18px 46px rgba(0, 0, 0, 0.22)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 34,
            lineHeight: 1,
            marginBottom: 8,
            animation: "my-shows-loader-float 1.7s ease-in-out infinite",
          }}
        >
          🍔
        </div>
        <h2
          style={{
            margin: 0,
            color: "#f8fafc",
            fontSize: isMobile ? 24 : 30,
            fontWeight: 950,
          }}
        >
          Loading your shows...
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            color: "#cbd5e1",
            fontWeight: 800,
            fontSize: isMobile ? 14 : 16,
          }}
        >
          Building your saved shows list
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {Array.from({ length: isMobile ? 4 : 6 }).map((_, index) => (
          <div
            key={index}
            style={{
              width: index === 0 ? 78 : 104,
              height: 30,
              borderRadius: 999,
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.075), transparent) -180px 0 / 180px 100% no-repeat, rgba(255,255,255,0.06)",
              animation: "my-shows-loader-shimmer 1.35s linear infinite",
            }}
          />
        ))}
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          height: 48,
          borderRadius: 14,
          marginBottom: 14,
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.075), transparent) -180px 0 / 180px 100% no-repeat, #182235",
          border: "1px solid #26324a",
          animation: "my-shows-loader-shimmer 1.35s linear infinite",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(4, minmax(0, 1fr))"
            : "repeat(auto-fill, minmax(160px, 1fr))",
          gap: isMobile ? 10 : 20,
          paddingBottom: 90,
        }}
      >
        {skeletonItems.map((_, index) => (
          <div
            key={index}
            style={{
              border: isMobile ? "none" : "1px solid #26324a",
              borderRadius: isMobile ? 0 : 18,
              padding: isMobile ? 0 : 12,
              background: isMobile ? "transparent" : "rgba(255,255,255,0.02)",
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio: "2 / 3",
                borderRadius: isMobile ? 10 : 14,
                marginBottom: isMobile ? 0 : 12,
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.075), transparent) -180px 0 / 180px 100% no-repeat, #111827",
                animation: "my-shows-loader-shimmer 1.35s linear infinite",
              }}
            />

            {!isMobile ? (
              <div
                style={{
                  height: 16,
                  width: `${62 + ((index % 3) * 12)}%`,
                  borderRadius: 999,
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.075), transparent) -180px 0 / 180px 100% no-repeat, rgba(255,255,255,0.08)",
                  animation: "my-shows-loader-shimmer 1.35s linear infinite",
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyShows() {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBy, setFilterBy] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function loadShows() {
    let hasVisibleShows = false;

    try {
      setLoading(true);

      const instantCachedShows = readLastMyShowsCache();
      if (Array.isArray(instantCachedShows)) {
        hasVisibleShows = true;
        setShows(instantCachedShows);
        setLoading(false);
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user || null;

      if (!user) {
        setShows([]);
        return;
      }

      const cachedShows = readMyShowsCache(user.id);
      const hasCachedShows = Array.isArray(cachedShows);

      if (hasCachedShows) {
        hasVisibleShows = true;
        setShows(cachedShows);
        setLoading(false);
        return;
      }

      const { data: userShows, error: userShowsError } = await supabase
        .from("user_shows_new")
        .select(`
          id,
          user_id,
          show_id,
          watch_status,
          archived_at,
          added_at,
          created_at,
          shows!inner(*)
        `)
        .eq("user_id", user.id);

      if (userShowsError) throw userShowsError;

      const normalizedUserShows = (userShows || []).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        show_id: row.show_id,
        watch_status: row.watch_status || "watching",
        archived_at: row.archived_at || null,
        added_at: row.added_at,
        created_at: row.created_at,
        tvdb_id: row.shows.tvdb_id,
        show_name: getPreferredShowName(row.shows),
        overview: row.shows.overview || "",
        status: row.shows.status || null,
        poster_url: row.shows.poster_url || null,
        first_aired: row.shows.first_aired || null,
      }));

      const immediateShows = normalizedUserShows.map((show) => {
        const statusValue = String(show.watch_status || "").toLowerCase();
        const isArchived = statusValue === "archived";
        const isCompleted = !isArchived && statusValue === "completed";
        const isInProgress =
          !isArchived &&
          !isCompleted &&
          (statusValue === "watching" ||
            statusValue === "in_progress" ||
            statusValue === "inprogress");
        const isWatchlist =
          !isArchived &&
          !isCompleted &&
          !isInProgress &&
          statusValue === "watchlist";

        return {
          ...show,
          nextEpisodeDate: null,
          daysToNextEpisode: null,
          watchedMainCount: 0,
          totalMainEpisodes: 0,
          status: null,
          isArchived,
          isWatchlist,
          isCompleted,
          isInProgress,
          isAiring: false,
          isAiringSoon: false,
          resolvedWatchStatus: isArchived
            ? "archived"
            : isCompleted
            ? "completed"
            : isInProgress
            ? "watching"
            : "watchlist",
        };
      });

      // Make the library usable as soon as the user's show rows are back.
      // Episode/progress data is hydrated below without holding up the grid.
      setShows(immediateShows);
      setLoading(false);
      hasVisibleShows = true;

      const showIds = normalizedUserShows
        .map((show) => show.show_id)
        .filter(Boolean);

      if (!showIds.length) {
        setShows([]);
        writeMyShowsCache(user.id, []);
        return;
      }

      const [watchedRows, allEpisodes] = await Promise.all([
        fetchAllWatchedEpisodeRows(user.id),
        fetchEpisodesForShowIds(showIds),
      ]);

      const watchedEpisodeIds = new Set(
        (watchedRows || [])
          .map((row) => row.episode_id)
          .filter(Boolean)
          .map(String)
      );

      const episodesByShowId = {};
      for (const ep of allEpisodes || []) {
        const key = ep.show_id;
        if (!episodesByShowId[key]) episodesByShowId[key] = [];
        episodesByShowId[key].push(ep);
      }

      const updatedShows = normalizedUserShows.map((userShow) => {
        const showEpisodes = episodesByShowId[userShow.show_id] || [];

        const mainEpisodes = showEpisodes.filter(
          (ep) => Number(ep.season_number ?? 0) !== 0
        );

        const futureMainEpisodes = mainEpisodes.filter(
          (ep) => ep.aired_date && !isAired(ep.aired_date)
        );

        const watchedMainCount = mainEpisodes.filter((ep) =>
          watchedEpisodeIds.has(String(ep.id))
        ).length;

        const totalMainEpisodes = mainEpisodes.length;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingEpisodes = futureMainEpisodes
          .filter((ep) => ep.aired_date)
          .filter((ep) => {
            const airDate = new Date(ep.aired_date);
            airDate.setHours(0, 0, 0, 0);
            return airDate >= today;
          })
          .sort((a, b) => new Date(a.aired_date) - new Date(b.aired_date));

        const nextEpisodeDate =
          upcomingEpisodes.length > 0 ? upcomingEpisodes[0].aired_date : null;

        const daysToNextEpisode = daysUntil(nextEpisodeDate);

        const statusEpisodes = mainEpisodes.map(toStatusEpisodeShape);

        const status = getShowStatus(
          {
            ...userShow,
            first_aired: userShow.first_aired,
          },
          statusEpisodes
        );

        const statusValue = String(userShow.watch_status || "").toLowerCase();
        const isArchived = statusValue === "archived";

        const computedCompleted =
          totalMainEpisodes > 0 && watchedMainCount >= totalMainEpisodes;
        const computedInProgress =
          watchedMainCount > 0 && !computedCompleted;

        const isCompleted =
          !isArchived && (statusValue === "completed" || computedCompleted);
        const isInProgress =
          !isArchived &&
          !isCompleted &&
          (statusValue === "watching" ||
            statusValue === "in_progress" ||
            statusValue === "inprogress" ||
            computedInProgress);
        const isWatchlist =
          !isArchived &&
          !isCompleted &&
          !isInProgress &&
          (statusValue === "watchlist" || watchedMainCount === 0);

        let resolvedWatchStatus = "watchlist";
        if (isArchived) resolvedWatchStatus = "archived";
        else if (isCompleted) resolvedWatchStatus = "completed";
        else if (isInProgress) resolvedWatchStatus = "watching";

        const isAiring = !!nextEpisodeDate && !isArchived;
        const isAiringSoon =
          !isArchived &&
          daysToNextEpisode != null &&
          daysToNextEpisode >= 0 &&
          daysToNextEpisode <= 30;

        return {
          ...userShow,
          nextEpisodeDate,
          daysToNextEpisode,
          watchedMainCount,
          totalMainEpisodes,
          status,
          isArchived,
          isWatchlist,
          isCompleted,
          isInProgress,
          isAiring,
          isAiringSoon,
          resolvedWatchStatus,
        };
      });

      setShows(updatedShows);
      writeMyShowsCache(user.id, updatedShows);

      const statusUpdates = updatedShows
        .filter((show) => {
          if (!show.show_id || !show.resolvedWatchStatus) return false;
          if (show.resolvedWatchStatus === "archived") return false;
          return show.watch_status !== show.resolvedWatchStatus;
        })
        .map((show) =>
          supabase
            .from("user_shows_new")
            .update({
              watch_status: show.resolvedWatchStatus,
              archived_at: null,
            })
            .eq("user_id", user.id)
            .eq("show_id", show.show_id)
        );

      if (statusUpdates.length) {
        Promise.allSettled(statusUpdates).catch((statusError) => {
          console.error("Failed syncing show statuses:", statusError);
        });
      }
    } catch (error) {
      console.error("LOAD SHOWS FAILED:", error);
      if (!hasVisibleShows) {
        setShows([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShows();
  }, []);

  const filteredShows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return shows.filter((show) => {
      const matchesFilter =
        filterBy === "all"
          ? true
          : filterBy === "watchlist"
          ? show.isWatchlist
          : filterBy === "inprogress"
          ? show.isInProgress
          : filterBy === "completed"
          ? show.isCompleted
          : filterBy === "archived"
          ? show.isArchived
          : filterBy === "airing"
          ? show.isAiringSoon && !show.isArchived
          : true;

      if (!matchesFilter) return false;

      if (!normalizedSearch) return true;

      return (show.show_name || "").toLowerCase().includes(normalizedSearch);
    });
  }, [shows, filterBy, searchTerm]);

  const displayedShows = useMemo(() => {
    return [...filteredShows].sort((a, b) =>
      (a.show_name || "").localeCompare(b.show_name || "")
    );
  }, [filteredShows]);

  const counts = useMemo(
    () => ({
      all: shows.length,
      watchlist: shows.filter((show) => show.isWatchlist).length,
      inprogress: shows.filter((show) => show.isInProgress).length,
      completed: shows.filter((show) => show.isCompleted).length,
      archived: shows.filter((show) => show.isArchived).length,
      airing: shows.filter((show) => show.isAiringSoon && !show.isArchived)
        .length,
    }),
    [shows]
  );

  const filters = [
    ["all", "⌂", `All (${counts.all})`],
    ["watchlist", "☆", `Watchlist (${counts.watchlist})`],
    ["inprogress", "▶", `In Progress (${counts.inprogress})`],
    ["completed", "✓", `Completed (${counts.completed})`],
    ["archived", "▣", `Archived (${counts.archived})`],
    ["airing", "◷", `Airing (${counts.airing})`],
  ];

  if (loading) {
    return <MyShowsLoading isMobile={isMobile} />;
  }

  return (
    <div className="page my-shows-page">
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 0,
          marginBottom: 10,
          paddingTop: 0,
        }}
      >
        {filters.map(([value, icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilterBy(value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "7px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                filterBy === value
                  ? "rgba(99,102,241,0.22)"
                  : "rgba(255,255,255,0.05)",
              color: filterBy === value ? "#ffffff" : "#cbd5e1",
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1,
              cursor: "pointer",
              opacity: filterBy === value ? 1 : 0.82,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 10, maxWidth: 420 }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search my shows..."
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid #26324a",
            background: "#182235",
            color: "#f8fafc",
            fontSize: "1rem",
            outline: "none",
          }}
        />
      </div>

      {displayedShows.length === 0 ? (
        <div className="show-card">
          <p>No shows found for this filter.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "repeat(4, minmax(0, 1fr))"
              : "repeat(auto-fill, minmax(160px, 1fr))",
            gap: isMobile ? 10 : 20,
          }}
        >
          {displayedShows.map((show) => (
            <Link
              key={show.show_id}
              to={`/my-shows/${show.tvdb_id}`}
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <div
                style={{
                  border: isMobile ? "none" : "1px solid #26324a",
                  borderRadius: isMobile ? 0 : 18,
                  padding: isMobile ? 0 : 12,
                  transition: "0.2s ease",
                  cursor: "pointer",
                  height: "100%",
                  background: "transparent",
                }}
              >
                {show.poster_url ? (
                  <img
                    src={show.poster_url}
                    alt={show.show_name}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      aspectRatio: "2 / 3",
                      objectFit: "cover",
                      borderRadius: isMobile ? 10 : 14,
                      display: "block",
                      background: "#111827",
                      marginBottom: isMobile ? 0 : 12,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "2 / 3",
                      borderRadius: isMobile ? 10 : 14,
                      background: "#111827",
                      marginBottom: isMobile ? 0 : 12,
                    }}
                  />
                )}

                {!isMobile && (
                  <div
                    style={{
                      color: "#f8fafc",
                      fontWeight: 800,
                      fontSize: "1rem",
                      lineHeight: 1.25,
                    }}
                  >
                    {show.show_name}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
