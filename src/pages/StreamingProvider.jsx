import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import "./StreamingProvider.css";

const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "rating", label: "Rating" },
  { value: "newest", label: "Newest" },
  { value: "az", label: "A-Z" },
];

function showLink(show) {
  if (show?.tvdb_id) return `/show/${show.tvdb_id}`;
  if (show?.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  return null;
}

function yearFromDate(value) {
  if (!value) return "";
  return String(value).slice(0, 4);
}

function ProviderPoster({ show }) {
  const title = show?.name || "Unknown show";

  if (!show?.poster_url) {
    return (
      <div className="streaming-show-poster streaming-show-poster-placeholder">
        <span>{title.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <img
      src={show.poster_url}
      alt={title}
      className="streaming-show-poster"
      loading="lazy"
      decoding="async"
    />
  );
}

function StreamingShowCard({ show }) {
  const target = showLink(show);
  const year = yearFromDate(show?.first_air_date);
  const rating = Number(show?.vote_average || 0);

  const content = (
    <>
      <div className="streaming-show-poster-wrap">
        <ProviderPoster show={show} />
        {rating > 0 ? (
          <span
            className="streaming-show-rating-badge"
            aria-label={`TMDB rating ${rating.toFixed(1)} out of 10`}
          >
            ★ {rating.toFixed(1)}
          </span>
        ) : null}
      </div>
      <div className="streaming-show-copy">
        <strong>{show?.name || "Unknown show"}</strong>
        {year ? <span className="streaming-show-year">{year}</span> : null}
      </div>
    </>
  );

  if (!target) {
    return <div className="streaming-show-card">{content}</div>;
  }

  return (
    <Link to={target} className="streaming-show-card">
      {content}
    </Link>
  );
}

function LoadingGrid() {
  return (
    <div className="streaming-show-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="streaming-show-card streaming-show-skeleton" key={index}>
          <div className="streaming-show-poster" />
          <div className="streaming-show-copy">
            <strong />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StreamingProvider() {
  const { providerId } = useParams();
  const [searchParams] = useSearchParams();
  const providerNameHint = searchParams.get("name") || "";
  const [provider, setProvider] = useState(null);
  const [genres, setGenres] = useState([]);
  const [shows, setShows] = useState([]);
  const [sort, setSort] = useState("popular");
  const [genre, setGenre] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestSerial = useRef(0);
  const loadMoreSentinelRef = useRef(null);
  const loadMoreInFlightRef = useRef(false);

  const endpointBase = useMemo(() => {
    const params = new URLSearchParams();
    if (/^\d+$/.test(String(providerId || ""))) {
      params.set("providerId", String(providerId));
    }
    if (providerNameHint) params.set("providerName", providerNameHint);
    return params;
  }, [providerId, providerNameHint]);

  useEffect(() => {
    let cancelled = false;
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;

    async function loadFirstPage() {
      setLoading(true);
      setError("");
      setShows([]);
      setPage(1);
      loadMoreInFlightRef.current = false;

      try {
        const params = new URLSearchParams(endpointBase);
        params.set("page", "1");
        params.set("sort", sort);
        if (genre) params.set("genre", genre);

        const response = await fetch(
          `/.netlify/functions/getStreamingProviderShows?${params.toString()}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Could not load this streaming service.");
        }

        if (cancelled || requestSerial.current !== serial) return;

        setProvider(payload?.provider || null);
        setGenres(Array.isArray(payload?.genres) ? payload.genres : []);
        setShows(Array.isArray(payload?.shows) ? payload.shows : []);
        setPage(Number(payload?.page || 1));
        setTotalPages(Number(payload?.total_pages || 1));
        setTotalResults(Number(payload?.total_results || 0));
      } catch (loadError) {
        if (cancelled || requestSerial.current !== serial) return;
        setError(loadError?.message || "Could not load this streaming service.");
      } finally {
        if (!cancelled && requestSerial.current === serial) {
          setLoading(false);
        }
      }
    }

    loadFirstPage();

    return () => {
      cancelled = true;
    };
  }, [endpointBase, sort, genre]);

  async function loadMore() {
    if (
      loadingMore ||
      loadMoreInFlightRef.current ||
      page >= totalPages
    ) {
      return;
    }

    loadMoreInFlightRef.current = true;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError("");

    try {
      const params = new URLSearchParams(endpointBase);
      params.set("page", String(nextPage));
      params.set("sort", sort);
      if (genre) params.set("genre", genre);

      const response = await fetch(
        `/.netlify/functions/getStreamingProviderShows?${params.toString()}`
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Could not load more shows.");
      }

      const incoming = Array.isArray(payload?.shows) ? payload.shows : [];
      setShows((current) => {
        const deduped = new Map(
          current.map((show) => [String(show.tmdb_id || show.tvdb_id), show])
        );
        incoming.forEach((show) => {
          deduped.set(String(show.tmdb_id || show.tvdb_id), show);
        });
        return [...deduped.values()];
      });
      setPage(Number(payload?.page || nextPage));
      setTotalPages(Number(payload?.total_pages || totalPages));
      setTotalResults(Number(payload?.total_results || totalResults));
    } catch (loadError) {
      setError(loadError?.message || "Could not load more shows.");
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;

    if (
      !sentinel ||
      loading ||
      loadingMore ||
      error ||
      page >= totalPages
    ) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [loading, loadingMore, error, page, totalPages, endpointBase, sort, genre]);

  const headingName = provider?.name || providerNameHint || "Streaming service";

  return (
    <main className="page streaming-provider-page">
      <section className="streaming-provider-hero">
        <div className="streaming-provider-brand">
          {provider?.logo_url ? (
            <img
              src={provider.logo_url}
              alt=""
              className="streaming-provider-logo"
            />
          ) : (
            <div className="streaming-provider-logo streaming-provider-logo-placeholder">
              TV
            </div>
          )}
          <div>
            <p className="streaming-provider-eyebrow">Streaming catalogue</p>
            <h1>{headingName}</h1>
            <p>TV shows currently listed as available to stream in the UK.</p>
          </div>
        </div>

        {!loading && !error ? (
          <div className="streaming-provider-count">
            <strong>{totalResults.toLocaleString()}</strong>
            <span>{totalResults === 1 ? "show" : "shows"}</span>
          </div>
        ) : null}
      </section>

      <section className="streaming-provider-controls" aria-label="Catalogue filters">
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Genre</span>
          <select value={genre} onChange={(event) => setGenre(event.target.value)}>
            <option value="">All genres</option>
            {genres.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && !shows.length ? (
        <section className="streaming-provider-state">
          <strong>Could not load {headingName}</strong>
          <p>{error}</p>
        </section>
      ) : null}

      {loading ? <LoadingGrid /> : null}

      {!loading && !error && shows.length === 0 ? (
        <section className="streaming-provider-state">
          <strong>No shows found</strong>
          <p>Try another genre or sort option.</p>
        </section>
      ) : null}

      {!loading && shows.length > 0 ? (
        <>
          <section className="streaming-show-grid">
            {shows.map((show) => (
              <StreamingShowCard
                show={show}
                key={show.tmdb_id || show.tvdb_id || show.id}
              />
            ))}
          </section>

          {error ? <p className="streaming-provider-inline-error">{error}</p> : null}

          {page < totalPages && !error ? (
            <div
              ref={loadMoreSentinelRef}
              className="streaming-auto-loader"
              aria-live="polite"
              aria-busy={loadingMore}
            >
              {loadingMore ? (
                <>
                  <span className="streaming-auto-loader-spinner" aria-hidden="true" />
                  <span>Loading more shows...</span>
                </>
              ) : (
                <span className="streaming-auto-loader-sentinel" aria-hidden="true" />
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
