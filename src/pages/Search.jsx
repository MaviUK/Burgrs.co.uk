import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatDate } from "../lib/date";
import { supabase } from "../lib/supabase";
import { addShowToUserList } from "../lib/userShows";
import "./Search.css";

const SEARCH_MODES = [
  { id: "title", label: "Title", placeholder: "Search for a show" },
  { id: "genre", label: "Genre", placeholder: "e.g. Crime, Comedy, Sci-Fi" },
  { id: "platform", label: "Platform", placeholder: "e.g. Netflix, Disney+, BBC iPlayer" },
  { id: "studio", label: "Studio", placeholder: "e.g. HBO, A24, Warner Bros" },
];

function withTimeout(promise, ms, message) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([
    Promise.resolve(promise).finally(() => window.clearTimeout(timerId)),
    timeoutPromise,
  ]);
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

function getBackdrop(show) {
  return (
    show.backdrop_url ||
    show.background_url ||
    show.banner_url ||
    show.fanart_url ||
    show.image_url ||
    show.poster_url ||
    null
  );
}

function getPoster(show) {
  return show.image_url || show.poster_url || null;
}

function getFirstAired(show) {
  return show.first_air_time || show.first_aired || show.first_air_date || null;
}

function getTotalSeasons(show) {
  return (
    show.total_seasons ||
    show.number_of_seasons ||
    show.seasons_count ||
    show.season_count ||
    show.seasons ||
    null
  );
}

function getTotalEpisodes(show) {
  return (
    show.total_episodes ||
    show.number_of_episodes ||
    show.episodes_count ||
    show.episode_count ||
    show.totalEpisodes ||
    null
  );
}

function getResultKey(show) {
  if (show?.tvdb_id) return `tvdb:${show.tvdb_id}`;
  if (show?.tmdb_id) return `tmdb:${show.tmdb_id}`;
  if (show?.id) return `id:${show.id}`;
  return `${show?.name || "show"}:${show?.first_aired || ""}`;
}

function mergeUniqueShows(existing, incoming) {
  const merged = new Map();
  [...existing, ...incoming].forEach((show) => {
    merged.set(getResultKey(show), show);
  });
  return Array.from(merged.values());
}

function getDetailHref(show, isSaved) {
  if (show?.tvdb_id) {
    return isSaved ? `/my-shows/${show.tvdb_id}` : `/show/${show.tvdb_id}`;
  }

  if (show?.tmdb_id) {
    return isSaved
      ? `/my-shows/tmdb/${show.tmdb_id}`
      : `/show/tmdb/${show.tmdb_id}`;
  }

  return "#";
}

function listText(value, limit = 3) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return values.slice(0, limit).join(", ");
}

export default function Search() {
  const [searchParams] = useSearchParams();
  const [searchMode, setSearchMode] = useState("title");
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [savedTvdbIds, setSavedTvdbIds] = useState(new Set());
  const [savedTmdbIds, setSavedTmdbIds] = useState(new Set());
  const [currentUserId, setCurrentUserId] = useState(null);
  const [matchedLabel, setMatchedLabel] = useState("");
  const [advancedPage, setAdvancedPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [activeAdvancedQuery, setActiveAdvancedQuery] = useState("");
  const [activeAdvancedMode, setActiveAdvancedMode] = useState("");

  const genreFilter = searchParams.get("genre") || "";
  const networkFilter = searchParams.get("network") || "";
  const relationshipTypeFilter = searchParams.get("relationshipType") || "";
  const settingFilter = searchParams.get("setting") || "";
  const sourceShowId = searchParams.get("sourceShowId") || "";
  const sourceYear = searchParams.get("sourceYear") || "";
  const sourceRating = searchParams.get("sourceRating") || "";
  const sourceLanguage = searchParams.get("sourceLanguage") || "";

  const currentMode = useMemo(
    () => SEARCH_MODES.find((mode) => mode.id === searchMode) || SEARCH_MODES[0],
    [searchMode]
  );

  const isPureNetworkBrowse =
    Boolean(networkFilter) &&
    !genreFilter &&
    !relationshipTypeFilter &&
    !settingFilter;

  useEffect(() => {
    let active = true;

    async function syncUser() {
      const userId = await getCurrentUserId();
      if (!active) return;
      setCurrentUserId(userId);
    }

    syncUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id || null);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      setAddingId(null);
      setError("");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (genreFilter) {
      setSearchMode("genre");
      setQuery(genreFilter);
    } else if (networkFilter) {
      setSearchMode("platform");
      setQuery(networkFilter);
    } else if (relationshipTypeFilter) {
      setSearchMode("title");
      setQuery(relationshipTypeFilter);
    } else if (settingFilter) {
      setSearchMode("title");
      setQuery(settingFilter);
    }
  }, [genreFilter, networkFilter, relationshipTypeFilter, settingFilter]);

  async function markAlreadySaved(results, userIdOverride = currentUserId) {
    const userId = userIdOverride || (await getCurrentUserId());

    if (!userId || !results.length) {
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }

    const { data, error: savedError } = await supabase
      .from("user_shows_new")
      .select("tmdb_id, shows!inner(tvdb_id)")
      .eq("user_id", userId);

    if (savedError) {
      console.error("Failed checking saved shows:", savedError);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }

    const latestUserId = await getCurrentUserId();
    if (latestUserId !== userId) return;

    setSavedTvdbIds(
      new Set(
        (data || [])
          .map((row) => row?.shows?.tvdb_id)
          .filter(Boolean)
          .map(String)
      )
    );
    setSavedTmdbIds(
      new Set(
        (data || [])
          .map((row) => row?.tmdb_id)
          .filter(Boolean)
          .map(String)
      )
    );
  }

  useEffect(() => {
    if (!shows.length) {
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }
    markAlreadySaved(shows, currentUserId);
  }, [currentUserId]);

  function resetPagination() {
    setAdvancedPage(1);
    setHasMore(false);
    setTotalResults(0);
    setActiveAdvancedQuery("");
    setActiveAdvancedMode("");
  }

  async function fetchLegacySearch(paramsObject) {
    setLoading(true);
    setError("");
    setMatchedLabel("");
    resetPagination();

    try {
      const activeUserId = await getCurrentUserId();
      setCurrentUserId(activeUserId);

      const params = new URLSearchParams();
      Object.entries(paramsObject).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
          params.set(key, value);
        }
      });

      const res = await fetch(`/.netlify/functions/searchShows?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Search failed");

      const results = (Array.isArray(data) ? data : []).filter(
        (show) => show?.tvdb_id || show?.tmdb_id
      );
      setShows(results);
      await markAlreadySaved(results, activeUserId);
    } catch (err) {
      console.error("Search failed:", err);
      setError(err.message || "Search failed");
      setShows([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAdvancedSearch(mode, searchQuery, page = 1, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);

    setError("");
    if (!append) setMatchedLabel("");

    try {
      const activeUserId = await getCurrentUserId();
      setCurrentUserId(activeUserId);

      const params = new URLSearchParams({
        mode,
        q: searchQuery,
        region: "GB",
        page: String(page),
      });
      const res = await fetch(
        `/.netlify/functions/advancedSearchShows?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Advanced search failed");

      const results = Array.isArray(data?.results) ? data.results : [];
      const combined = append ? mergeUniqueShows(shows, results) : results;

      setShows(combined);
      setMatchedLabel(data?.matched || searchQuery);
      setAdvancedPage(Number(data?.page || page));
      setHasMore(Boolean(data?.hasMore));
      setTotalResults(Number(data?.totalResults || combined.length));
      setActiveAdvancedQuery(searchQuery);
      setActiveAdvancedMode(mode);
      await markAlreadySaved(combined, activeUserId);
    } catch (err) {
      console.error("Advanced search failed:", err);
      setError(err.message || "Advanced search failed");
      if (!append) {
        setShows([]);
        resetPagination();
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const hasFilter =
      Boolean(genreFilter) ||
      Boolean(networkFilter) ||
      Boolean(relationshipTypeFilter) ||
      Boolean(settingFilter);

    if (!hasFilter) return;

    fetchLegacySearch({
      genre: genreFilter || null,
      network: networkFilter || null,
      relationshipType: relationshipTypeFilter || null,
      setting: settingFilter || null,
      sourceShowId: sourceShowId || null,
      sourceYear: isPureNetworkBrowse ? null : sourceYear || null,
      sourceRating: isPureNetworkBrowse ? null : sourceRating || null,
      sourceLanguage: sourceLanguage || null,
    });
  }, [
    genreFilter,
    networkFilter,
    relationshipTypeFilter,
    settingFilter,
    sourceShowId,
    sourceYear,
    sourceRating,
    sourceLanguage,
    isPureNetworkBrowse,
  ]);

  async function handleManualSearch() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || loading || loadingMore) return;

    if (searchMode === "title") {
      await fetchLegacySearch({ q: trimmedQuery });
      return;
    }

    await fetchAdvancedSearch(searchMode, trimmedQuery, 1, false);
  }

  async function handleLoadMore() {
    if (
      loading ||
      loadingMore ||
      !hasMore ||
      !activeAdvancedQuery ||
      !activeAdvancedMode
    ) {
      return;
    }

    await fetchAdvancedSearch(
      activeAdvancedMode,
      activeAdvancedQuery,
      advancedPage + 1,
      true
    );
  }

  function changeMode(nextMode) {
    if (nextMode === searchMode) return;
    setSearchMode(nextMode);
    setQuery("");
    setShows([]);
    setMatchedLabel("");
    setError("");
    resetPagination();
  }

  async function handleAddShow(event, show) {
    event.preventDefault();
    event.stopPropagation();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Please log in to add shows.");
      return;
    }

    const addKey = getResultKey(show);
    if (!show?.tvdb_id && !show?.tmdb_id) {
      setError("This show is missing its database IDs and cannot be added.");
      return;
    }

    setCurrentUserId(user.id);
    setAddingId(addKey);
    setError("");

    try {
      await withTimeout(
        addShowToUserList({
          ...show,
          id: show.tvdb_id || show.tmdb_id,
          source: show.tvdb_id ? "tvdb" : "tmdb",
          tvdb_id: show.tvdb_id ? Number(show.tvdb_id) : null,
          tmdb_id: show.tmdb_id ? Number(show.tmdb_id) : null,
          name: show.name || show.show_name || "Unknown Show",
          poster_url: show.image_url || show.poster_url || null,
          overview: show.overview || null,
          first_air_date: getFirstAired(show),
          first_aired: getFirstAired(show),
          status: show.status || null,
        }),
        120000,
        "Add show timed out while syncing data."
      );

      await markAlreadySaved(shows, user.id);
    } catch (err) {
      console.error("Failed to add show:", err);
      setError(err.message || "Failed to add show.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-shell search-shell">
        <div className="search-mode-wrap" role="tablist" aria-label="Search by">
          {SEARCH_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={searchMode === mode.id}
              className={`search-mode-button${searchMode === mode.id ? " is-active" : ""}`}
              onClick={() => changeMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="search-bar-wrap">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleManualSearch();
            }}
            placeholder={currentMode.placeholder}
            className="search-page-input"
            aria-label={`${currentMode.label} search`}
          />

          <button
            type="button"
            onClick={handleManualSearch}
            disabled={loading || loadingMore || !query.trim()}
            className="msd-btn msd-btn-secondary search-page-button"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {searchMode === "platform" ? (
          <p className="search-mode-help">
            Platform results use UK streaming availability.
          </p>
        ) : null}

        {error ? <p className="search-error-text">{error}</p> : null}

        {matchedLabel && !loading ? (
          <div className="search-match-summary">
            Showing {shows.length}
            {totalResults > shows.length ? ` of ${totalResults}` : ""} {searchMode} results for {" "}
            <strong>{matchedLabel}</strong>
          </div>
        ) : null}

        <div className="search-results-list">
          {shows.map((show) => {
            const resultKey = getResultKey(show);
            const isSaved =
              (show.tvdb_id && savedTvdbIds.has(String(show.tvdb_id))) ||
              (show.tmdb_id && savedTmdbIds.has(String(show.tmdb_id)));
            const isAdding = addingId === resultKey;
            const detailHref = getDetailHref(show, isSaved);
            const backdrop = getBackdrop(show);
            const poster = getPoster(show);
            const firstAired = getFirstAired(show);
            const totalSeasons = getTotalSeasons(show);
            const totalEpisodes = getTotalEpisodes(show);
            const genres = listText(show.genres);
            const platform = show.platform || show.network || "";
            const studio = show.studio || listText(show.studios, 2);

            return (
              <div
                key={resultKey}
                className="search-result-banner-card"
                style={
                  backdrop
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(9,14,26,0.96) 0%, rgba(9,14,26,0.84) 42%, rgba(9,14,26,0.92) 100%), url(${backdrop})`,
                      }
                    : undefined
                }
              >
                <div className="search-result-banner-inner">
                  <Link to={detailHref} className="search-result-poster-link">
                    {poster ? (
                      <img
                        src={poster}
                        alt={show.name || show.show_name || "Show poster"}
                        className="search-result-poster"
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                      />
                    ) : (
                      <div className="search-result-poster search-result-poster-placeholder" />
                    )}
                  </Link>

                  <div className="search-result-content">
                    <Link to={detailHref} className="search-result-title-link">
                      <h3 className="search-result-title">
                        {show.name || show.show_name}
                      </h3>
                    </Link>

                    <div className="search-result-meta">
                      {firstAired ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">First aired</span>
                          <span className="search-result-meta-value">
                            {formatDate(firstAired)}
                          </span>
                        </div>
                      ) : null}

                      {platform ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Platform</span>
                          <span className="search-result-meta-value">{platform}</span>
                        </div>
                      ) : null}

                      {studio ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Studio</span>
                          <span className="search-result-meta-value">{studio}</span>
                        </div>
                      ) : null}

                      {genres ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Genre</span>
                          <span className="search-result-meta-value">{genres}</span>
                        </div>
                      ) : null}

                      {totalSeasons ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Total seasons</span>
                          <span className="search-result-meta-value">{totalSeasons}</span>
                        </div>
                      ) : null}

                      {totalEpisodes ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Total episodes</span>
                          <span className="search-result-meta-value">{totalEpisodes}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="search-result-actions">
                      <button
                        type="button"
                        onClick={(event) => handleAddShow(event, show)}
                        disabled={isSaved || isAdding}
                        className={`search-add-btn ${isSaved ? "is-saved" : ""}`}
                      >
                        {isSaved ? "Added" : isAdding ? "Adding..." : "Add Show"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && shows.length > 0 ? (
          <button
            type="button"
            className="search-load-more-button"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading more shows..." : "Load more shows"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
