import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatDate } from "../lib/date";
import { supabase } from "../lib/supabase";
import { addShowToUserList } from "../lib/userShows";
import "./Search.css";

const SEARCH_MODES = [
  { id: "title", label: "Title", placeholder: "Search for a show" },
  { id: "genre", label: "Genre", placeholder: "e.g. Crime, Comedy, Sci-Fi" },
  { id: "year", label: "Year", placeholder: "e.g. 1973 or 1990s" },
  { id: "platform", label: "Platform", placeholder: "e.g. Netflix, Disney+, BBC iPlayer" },
  { id: "studio", label: "Studio", placeholder: "e.g. HBO, A24, Warner Bros" },
];

const EMPTY_FILTERS = {
  title: "",
  genre: "",
  year: "",
  platform: "",
  studio: "",
};

const SORT_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "highest-rated", label: "Highest rated" },
  { id: "lowest-rated", label: "Lowest rated" },
  { id: "most-popular", label: "Most popular" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "a-z", label: "A-Z" },
];

const SEARCH_SESSION_KEY = "burgrs:search-session:v1";

function readSearchSession() {
  try {
    const raw = window.sessionStorage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Could not restore search session", error);
    return null;
  }
}

function writeSearchSession(value) {
  try {
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("Could not save search session", error);
  }
}

function hasActiveFilters(filters) {
  return Object.values(filters || {}).some((value) => String(value || "").trim());
}

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


function getRatingPercent(show) {
  const raw = Number(
    show?.rating_average ??
      show?.vote_average ??
      show?.rating ??
      show?.score ??
      0
  );

  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw <= 10) return Math.round(raw * 10);
  if (raw <= 100) return Math.round(raw);
  return null;
}

function getRatingSource(show) {
  const source = String(show?.source || "").trim().toLowerCase();
  if (source === "tmdb") return "TMDB";
  if (source === "tvdb") return "TVDB";
  return "Source";
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

function sortLoadedShows(items, sort) {
  const results = [...(items || [])];

  if (sort === "highest-rated") {
    return results.sort((a, b) => {
      const ratingDiff =
        Number(getRatingPercent(b) || 0) - Number(getRatingPercent(a) || 0);
      if (ratingDiff) return ratingDiff;
      return Number(b?.rating_count || b?.vote_count || 0) -
        Number(a?.rating_count || a?.vote_count || 0);
    });
  }

  if (sort === "lowest-rated") {
    return results.sort((a, b) => {
      const aRating = getRatingPercent(a);
      const bRating = getRatingPercent(b);

      if (aRating == null && bRating == null) return 0;
      if (aRating == null) return 1;
      if (bRating == null) return -1;

      const ratingDiff = Number(aRating) - Number(bRating);
      if (ratingDiff) return ratingDiff;

      return Number(b?.rating_count || b?.vote_count || 0) -
        Number(a?.rating_count || a?.vote_count || 0);
    });
  }

  if (sort === "most-popular") {
    return results.sort(
      (a, b) => Number(b?.popularity || 0) - Number(a?.popularity || 0)
    );
  }

  if (sort === "newest" || sort === "oldest") {
    const direction = sort === "newest" ? -1 : 1;
    return results.sort((a, b) => {
      const aDate = String(getFirstAired(a) || "");
      const bDate = String(getFirstAired(b) || "");
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.localeCompare(bDate) * direction;
    });
  }

  if (sort === "a-z") {
    return results.sort((a, b) =>
      String(a?.name || a?.show_name || "").localeCompare(
        String(b?.name || b?.show_name || ""),
        "en",
        { sensitivity: "base" }
      )
    );
  }

  return results;
}

function getDetailHref(show, savedByTvdb, savedByTmdb) {
  if (savedByTvdb && show?.tvdb_id) {
    return `/my-shows/${show.tvdb_id}`;
  }

  if (savedByTmdb && show?.tmdb_id) {
    return `/my-shows/tmdb/${show.tmdb_id}`;
  }

  if (show?.tvdb_id) {
    return `/show/${show.tvdb_id}`;
  }

  if (show?.tmdb_id) {
    return `/show/tmdb/${show.tmdb_id}`;
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
  const [activeFilters, setActiveFilters] = useState(() => ({ ...EMPTY_FILTERS }));
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...EMPTY_FILTERS }));
  const [sortOrder, setSortOrder] = useState("default");
  const loadMoreRef = useRef(null);
  const restoringSearchRef = useRef(false);

  const titleQuery = searchParams.get("q") || "";
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

  const visualOrderMap = useMemo(() => {
    const ordered = sortLoadedShows(shows, sortOrder);
    return new Map(
      ordered.map((show, index) => [getResultKey(show), index])
    );
  }, [shows, sortOrder]);

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
    const hasUrlDrivenSearch =
      Boolean(titleQuery) ||
      Boolean(genreFilter) ||
      Boolean(networkFilter) ||
      Boolean(relationshipTypeFilter) ||
      Boolean(settingFilter);

    if (hasUrlDrivenSearch) return;

    const saved = readSearchSession();
    if (!saved) return;

    restoringSearchRef.current = true;

    setSearchMode(saved.searchMode || "title");
    setQuery(saved.query || "");
    setShows(Array.isArray(saved.shows) ? saved.shows : []);
    setMatchedLabel(saved.matchedLabel || "");
    setAdvancedPage(Number(saved.advancedPage || 1));
    setHasMore(Boolean(saved.hasMore));
    setTotalResults(Number(saved.totalResults || 0));
    setActiveFilters({ ...EMPTY_FILTERS, ...(saved.activeFilters || {}) });
    setAppliedFilters({ ...EMPTY_FILTERS, ...(saved.appliedFilters || {}) });
    setSortOrder(saved.sortOrder || "default");

    const scrollY = Math.max(0, Number(saved.scrollY || 0));
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
        restoringSearchRef.current = false;
      });
    });
  }, []);

  useEffect(() => {
    if (restoringSearchRef.current) return;

    const previous = readSearchSession();
    writeSearchSession({
      searchMode,
      query,
      shows,
      matchedLabel,
      advancedPage,
      hasMore,
      totalResults,
      activeFilters,
      appliedFilters,
      sortOrder,
      scrollY: Number(previous?.scrollY || 0),
    });
  }, [
    searchMode,
    query,
    shows,
    matchedLabel,
    advancedPage,
    hasMore,
    totalResults,
    activeFilters,
    appliedFilters,
    sortOrder,
  ]);

  function rememberSearchPosition() {
    writeSearchSession({
      searchMode,
      query,
      shows,
      matchedLabel,
      advancedPage,
      hasMore,
      totalResults,
      activeFilters,
      appliedFilters,
      sortOrder,
      scrollY: window.scrollY || 0,
    });
  }

  useEffect(() => {
    if (titleQuery) {
      const next = { ...EMPTY_FILTERS, title: titleQuery };
      setSearchMode("title");
      setQuery(titleQuery);
      setActiveFilters(next);
      setAppliedFilters(next);
    } else if (genreFilter) {
      const next = { ...EMPTY_FILTERS, genre: genreFilter };
      setSearchMode("genre");
      setQuery(genreFilter);
      setActiveFilters(next);
      setAppliedFilters(next);
    } else if (networkFilter) {
      const next = { ...EMPTY_FILTERS, platform: networkFilter };
      setSearchMode("platform");
      setQuery(networkFilter);
      setActiveFilters(next);
      setAppliedFilters(next);
    } else if (relationshipTypeFilter) {
      setSearchMode("title");
      setQuery(relationshipTypeFilter);
      setActiveFilters({ ...EMPTY_FILTERS });
      setAppliedFilters({ ...EMPTY_FILTERS });
    } else if (settingFilter) {
      setSearchMode("title");
      setQuery(settingFilter);
      setActiveFilters({ ...EMPTY_FILTERS });
      setAppliedFilters({ ...EMPTY_FILTERS });
    }
  }, [titleQuery, genreFilter, networkFilter, relationshipTypeFilter, settingFilter]);

  async function markAlreadySaved(results, userIdOverride = currentUserId) {
    const userId = userIdOverride || (await getCurrentUserId());

    if (!userId || !results.length) {
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }

    const { data, error: savedError } = await supabase
      .from("user_shows_new")
      .select("shows!inner(tvdb_id, tmdb_id)")
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
          .map((row) => row?.shows?.tmdb_id)
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

  async function fetchCombinedSearch(
    filters,
    page = 1,
    append = false,
    sortOverride = sortOrder
  ) {
    if (append) setLoadingMore(true);
    else setLoading(true);

    setError("");
    if (!append) setMatchedLabel("");

    try {
      const activeUserId = await getCurrentUserId();
      setCurrentUserId(activeUserId);

      const params = new URLSearchParams({
        region: "GB",
        page: String(page),
        sort: sortOverride,
        sortVersion: "4",
      });

      Object.entries(filters || {}).forEach(([key, value]) => {
        const trimmed = String(value || "").trim();
        if (trimmed) params.set(key, trimmed);
      });

      const res = await fetch(
        `/.netlify/functions/advancedSearchShows?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Refined search failed");

      const results = Array.isArray(data?.results) ? data.results : [];
      const combined = sortLoadedShows(
        append ? mergeUniqueShows(shows, results) : results,
        sortOverride
      );
      const returnedTotal = Number(data?.totalResults);
      const safeTotal =
        Number.isFinite(returnedTotal) && returnedTotal > 0
          ? Math.max(returnedTotal, combined.length)
          : combined.length;

      setShows(combined);
      setActiveFilters({ ...EMPTY_FILTERS, ...(filters || {}) });
      setAppliedFilters({
        ...EMPTY_FILTERS,
        ...(data?.appliedFilters || filters || {}),
      });
      setMatchedLabel(
        data?.matched ||
          Object.values(filters || {})
            .filter(Boolean)
            .join(" + ")
      );
      setAdvancedPage(Number(data?.page || page));
      const nextHasMore =
        Boolean(data?.hasMore) ||
        safeTotal > combined.length ||
        results.length >= 20;
      setHasMore(nextHasMore);
      setTotalResults(safeTotal);
      await markAlreadySaved(combined, activeUserId);
    } catch (err) {
      console.error("Refined search failed:", err);
      setError(err.message || "Refined search failed");
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
    if (!titleQuery) return;
    fetchLegacySearch({ q: titleQuery });
  }, [titleQuery]);

  useEffect(() => {
    const hasFilter =
      Boolean(genreFilter) ||
      Boolean(networkFilter) ||
      Boolean(relationshipTypeFilter) ||
      Boolean(settingFilter);

    if (!hasFilter || titleQuery) return;

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

    const nextFilters = {
      ...activeFilters,
      [searchMode]: trimmedQuery,
    };

    await fetchCombinedSearch(nextFilters, 1, false, sortOrder);
  }

  async function handleLoadMore() {
    if (
      loading ||
      loadingMore ||
      !hasMore ||
      !hasActiveFilters(activeFilters)
    ) {
      return;
    }

    await fetchCombinedSearch(
      activeFilters,
      advancedPage + 1,
      true,
      sortOrder
    );
  }

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || !shows.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !loading && !loadingMore) {
          handleLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "350px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    hasMore,
    shows.length,
    loading,
    loadingMore,
    advancedPage,
    activeFilters,
    sortOrder,
  ]);

  async function handleSortChange(nextSort) {
    if (nextSort === sortOrder || loading || loadingMore) return;

    setSortOrder(nextSort);

    // Give immediate feedback, then reload page 1 using the selected sort so
    // pagination and infinite scroll remain tied to the same ordering.
    setShows((currentShows) => sortLoadedShows(currentShows, nextSort));

    if (!hasActiveFilters(activeFilters)) return;

    await fetchCombinedSearch(activeFilters, 1, false, nextSort);
  }

  useEffect(() => {
    if (sortOrder === "default" || !shows.length) return;
    setShows((currentShows) => {
      const sorted = sortLoadedShows(currentShows, sortOrder);
      const unchanged = sorted.every(
        (show, index) => getResultKey(show) === getResultKey(currentShows[index])
      );
      return unchanged ? currentShows : sorted;
    });
  }, [sortOrder]);

  function changeMode(nextMode) {
    if (nextMode === searchMode) return;
    setSearchMode(nextMode);
    setQuery(activeFilters[nextMode] || "");
    setError("");
  }

  async function removeFilter(filterId) {
    const nextFilters = {
      ...activeFilters,
      [filterId]: "",
    };
    const nextApplied = {
      ...appliedFilters,
      [filterId]: "",
    };

    setActiveFilters(nextFilters);
    setAppliedFilters(nextApplied);
    setError("");
    if (searchMode === filterId) setQuery("");

    if (hasActiveFilters(nextFilters)) {
      await fetchCombinedSearch(nextFilters, 1, false);
      return;
    }

    setShows([]);
    setMatchedLabel("");
    resetPagination();
  }

  function clearAllFilters() {
    setActiveFilters({ ...EMPTY_FILTERS });
    setAppliedFilters({ ...EMPTY_FILTERS });
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

        {hasActiveFilters(activeFilters) ? (
          <div className="search-refine-wrap">
            <div className="search-refine-head">
              <span>Refine results</span>
              <button
                type="button"
                className="search-clear-filters"
                onClick={clearAllFilters}
              >
                Clear all
              </button>
            </div>
            <div className="search-filter-chips">
              {SEARCH_MODES.filter((mode) => activeFilters[mode.id]).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className="search-filter-chip"
                  onClick={() => removeFilter(mode.id)}
                  aria-label={`Remove ${mode.label} filter`}
                >
                  <span className="search-filter-chip-label">{mode.label}:</span>
                  <span>{appliedFilters[mode.id] || activeFilters[mode.id]}</span>
                  <span className="search-filter-chip-x" aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="search-error-text">{error}</p> : null}

        {matchedLabel && !loading ? (
          <div className="search-match-summary">
            Showing {shows.length}
            {totalResults > shows.length ? ` of ${totalResults}` : ""} results matching{" "}
            <strong>{matchedLabel}</strong>
          </div>
        ) : null}

        {shows.length > 0 ? (
          <div className="search-sort-row">
            <label htmlFor="search-sort-select">Sort by</label>
            <select
              id="search-sort-select"
              className="search-sort-select"
              value={sortOrder}
              onChange={(event) => handleSortChange(event.target.value)}
              disabled={loading || loadingMore}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="search-results-list">
          {shows.map((show) => {
            const resultKey = getResultKey(show);
            const savedByTvdb = Boolean(
              show.tvdb_id && savedTvdbIds.has(String(show.tvdb_id))
            );
            const savedByTmdb = Boolean(
              show.tmdb_id && savedTmdbIds.has(String(show.tmdb_id))
            );
            const isSaved = savedByTvdb || savedByTmdb;
            const isAdding = addingId === resultKey;
            const detailHref = getDetailHref(show, savedByTvdb, savedByTmdb);
            const backdrop = getBackdrop(show);
            const poster = getPoster(show);
            const ratingPercent = getRatingPercent(show);
            const ratingSource = getRatingSource(show);
            const firstAired = getFirstAired(show);
            const totalSeasons = getTotalSeasons(show);
            const totalEpisodes = getTotalEpisodes(show);
            const genres = listText(show.genres);
            const platform = show.platform || show.network || "";
            const studio = show.studio || listText(show.studios, 2);
            const matchedAlias =
              show.matched_alias &&
              String(show.matched_alias).trim().toLowerCase() !==
                String(show.name || show.show_name || "").trim().toLowerCase()
                ? String(show.matched_alias).trim()
                : "";

            return (
              <div
                key={resultKey}
                className="search-result-banner-card"
                style={{
                  order: visualOrderMap.get(resultKey) ?? 0,
                  ...(backdrop
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(9,14,26,0.96) 0%, rgba(9,14,26,0.84) 42%, rgba(9,14,26,0.92) 100%), url(${backdrop})`,
                      }
                    : {}),
                }}
              >
                <div className="search-result-banner-inner">
                  <Link
                    to={detailHref}
                    className="search-result-poster-link"
                    onClick={rememberSearchPosition}
                  >
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
                    {ratingPercent ? (
                      <span
                        className="search-result-rating-badge"
                        aria-label={`${ratingSource} rating ${ratingPercent}%`}
                        title={`${ratingSource} rating`}
                      >
                        {ratingPercent}%
                      </span>
                    ) : null}
                  </Link>

                  <div className="search-result-content">
                    <Link
                      to={detailHref}
                      className="search-result-title-link"
                      onClick={rememberSearchPosition}
                    >
                      <h3 className="search-result-title">
                        {show.name || show.show_name}
                      </h3>
                    </Link>

                    <div className="search-result-meta">
                      {matchedAlias ? (
                        <div className="search-result-meta-row">
                          <span className="search-result-meta-label">Also known as</span>
                          <span className="search-result-meta-value">{matchedAlias}</span>
                        </div>
                      ) : null}

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
          <div
            ref={loadMoreRef}
            className="search-auto-load-sentinel"
            aria-live="polite"
          >
            {loadingMore ? "Loading more shows..." : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
