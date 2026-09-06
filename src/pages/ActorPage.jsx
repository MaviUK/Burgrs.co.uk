import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addShowToUserList } from "../lib/userShows";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/date";
import {
  getMappedShowHref,
  normalizeMappedShow,
} from "../lib/tmdbMappings";
import "./ActorPage.css";

function buildFallbackActor(name, credits) {
  const firstWithImage = credits.find((item) => item?.profile_url);

  return {
    name: decodeURIComponent(name || "").replace(/\+/g, " "),
    biography: "",
    birthday: "",
    place_of_birth: "",
    profile_url: firstWithImage?.profile_url || "",
  };
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

function getTvdbIdFromHref(href) {
  if (!href || typeof href !== "string") return null;

  const patterns = [
    /\/show\/(\d+)(?:\/)?$/i,
    /\/shows\/(\d+)(?:\/)?$/i,
    /\/show\/tvdb\/(\d+)(?:\/)?$/i,
    /tvdb[_-]?id[=/](\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = href.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function getResolvedTvdbId(show) {
  if (!show) return null;

  const direct =
    show?.resolved_tvdb_id ||
    show?.tvdb_id ||
    show?.mapped_tvdb_id ||
    show?.show_tvdb_id ||
    show?.tvdb ||
    show?.series_tvdb_id ||
    null;

  if (direct) return String(direct);

  const href =
    show?.href ||
    show?.mapped_href ||
    show?.show_href ||
    getMappedShowHref(show) ||
    "";

  return getTvdbIdFromHref(href);
}

function getResolvedTmdbId(show) {
  const value = show?.tmdb_id || show?.id || show?.series_tmdb_id || null;
  return value ? String(value) : null;
}

function getShowDestination(show, savedByTvdb, savedByTmdb) {
  const tvdbId = getResolvedTvdbId(show);
  const tmdbId = getResolvedTmdbId(show);

  if (savedByTvdb && tvdbId) {
    return `/my-shows/${tvdbId}`;
  }

  if (savedByTmdb && tmdbId) {
    return `/my-shows/tmdb/${tmdbId}`;
  }

  if (tvdbId) {
    return `/show/${tvdbId}`;
  }

  if (tmdbId) {
    return `/show/tmdb/${tmdbId}`;
  }

  return show?.href || getMappedShowHref(show);
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

export default function ActorPage() {
  const { name } = useParams();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [name]);

  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState(null);
  const [credits, setCredits] = useState([]);
  const [error, setError] = useState("");
  const [addingKey, setAddingKey] = useState(null);
  const [savedTvdbIds, setSavedTvdbIds] = useState(new Set());
  const [savedTmdbIds, setSavedTmdbIds] = useState(new Set());
  const [currentUserId, setCurrentUserId] = useState(null);
  const [bioOpen, setBioOpen] = useState(false);
  const [openShowDescriptionKey, setOpenShowDescriptionKey] = useState(null);

  async function loadSavedShowsForUser(userId) {
    if (!userId) {
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }

    const { data, error: savedError } = await supabase
      .from("user_shows_new")
      .select(`
        shows!inner(
          tvdb_id,
          tmdb_id
        )
      `)
      .eq("user_id", userId);

    if (savedError) {
      console.warn("Failed loading saved ids", savedError);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      return;
    }

    const latestUserId = await getCurrentUserId();
    if (latestUserId !== userId) return;

    const tvdbIds = new Set(
      (data || [])
        .map((row) => row?.shows?.tvdb_id)
        .filter(Boolean)
        .map(String)
    );

    const tmdbIds = new Set(
      (data || [])
        .map((row) => row?.shows?.tmdb_id)
        .filter(Boolean)
        .map(String)
    );

    setSavedTvdbIds(tvdbIds);
    setSavedTmdbIds(tmdbIds);
  }

  useEffect(() => {
    let active = true;

    async function syncUser() {
      const userId = await getCurrentUserId();
      if (!active) return;
      setCurrentUserId(userId);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      await loadSavedShowsForUser(userId);
    }

    syncUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id || null;
      setCurrentUserId(userId);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());
      setAddingKey(null);
      if (userId) loadSavedShowsForUser(userId);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActor() {
      setLoading(true);
      setError("");
      setBioOpen(false);
      setOpenShowDescriptionKey(null);
      setSavedTvdbIds(new Set());
      setSavedTmdbIds(new Set());

      try {
        const activeUserId = await getCurrentUserId();
        setCurrentUserId(activeUserId);

        const response = await fetch(
          `/.netlify/functions/getActorShows?name=${encodeURIComponent(name)}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.message || "Failed to load actor shows");
        }

        const rawCredits = Array.isArray(data)
          ? data
          : Array.isArray(data?.credits)
            ? data.credits
            : [];

        const normalizedCredits = rawCredits.map((item) => {
          const mapped = normalizeMappedShow({
            ...item,
            source: item?.source || "tmdb",
            name: item?.name || item?.title || item?.show_name || "Unknown show",
            first_air_date:
              item?.first_air_date ||
              item?.firstAired ||
              item?.first_aired ||
              "",
            poster_url:
              item?.poster_url ||
              item?.posterUrl ||
              item?.image_url ||
              (item?.poster_path
                ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                : ""),
            backdrop_url:
              item?.backdrop_url ||
              item?.background_url ||
              item?.banner_url ||
              item?.fanart_url ||
              (item?.backdrop_path
                ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
                : ""),
          });

          const href = getMappedShowHref({
            ...item,
            ...mapped,
          });

          const fallbackTvdbId =
            item?.resolved_tvdb_id ||
            item?.tvdb_id ||
            item?.mapped_tvdb_id ||
            item?.show_tvdb_id ||
            item?.tvdb ||
            item?.series_tvdb_id ||
            getTvdbIdFromHref(href) ||
            null;

          return {
            ...item,
            ...mapped,
            href,
            resolved_tvdb_id:
              mapped?.resolved_tvdb_id ||
              mapped?.tvdb_id ||
              fallbackTvdbId ||
              null,
            tmdb_id:
              item?.tmdb_id ||
              mapped?.tmdb_id ||
              item?.id ||
              mapped?.id ||
              null,
          };
        });

        const actorPayload =
          data?.actor || buildFallbackActor(name, normalizedCredits);

        if (!cancelled) {
          setActor(actorPayload);
          setCredits(normalizedCredits);
        }

        await loadSavedShowsForUser(activeUserId);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Failed to load actor shows");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadActor();

    return () => {
      cancelled = true;
    };
  }, [name]);

  async function handleAddShow(event, show) {
    event.preventDefault();
    event.stopPropagation();

    const userId = await getCurrentUserId();
    if (!userId) {
      alert("Please log in to add shows.");
      return;
    }

    setCurrentUserId(userId);

    const tvdbId = getResolvedTvdbId(show);
    const tmdbId = getResolvedTmdbId(show);
    const addKey = tvdbId ? `tvdb:${tvdbId}` : tmdbId ? `tmdb:${tmdbId}` : null;

    if (!addKey || addingKey) return;

    setAddingKey(addKey);

    try {
      await addShowToUserList({
        tvdb_id: tvdbId ? Number(tvdbId) : null,
        id: tvdbId ? Number(tvdbId) : tmdbId ? Number(tmdbId) : null,
        tmdb_id: tmdbId ? Number(tmdbId) : null,
        name: show?.name || show?.title || "Unknown show",
        overview: show?.overview || null,
        poster_url: show?.poster_url || show?.image_url || null,
        backdrop_url:
          show?.backdrop_url ||
          show?.background_url ||
          show?.banner_url ||
          show?.fanart_url ||
          null,
        first_air_date: show?.first_air_date || show?.first_aired || null,
        first_aired: show?.first_air_date || show?.first_aired || null,
        character: show?.character || null,
        status: show?.status || null,
        source: tvdbId ? "tvdb" : "tmdb",
      });

      await loadSavedShowsForUser(userId);
    } catch (err) {
      console.error("Failed adding show", err);
      alert(err?.message || "Failed to add show");
    } finally {
      setAddingKey(null);
    }
  }

  function toggleShowDescription(event, key) {
    event.preventDefault();
    event.stopPropagation();
    setOpenShowDescriptionKey((prev) => (prev === key ? null : key));
  }

  function toggleBio(event) {
    event.preventDefault();
    event.stopPropagation();
    setBioOpen((prev) => !prev);
  }

  const savedTvdbLookup = useMemo(() => savedTvdbIds, [savedTvdbIds]);
  const savedTmdbLookup = useMemo(() => savedTmdbIds, [savedTmdbIds]);

  if (loading) {
    return (
      <div className="actor-page">
        <div className="actor-shell">
          <div className="actor-empty">Loading actor...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="actor-page">
        <div className="actor-shell">
          <div className="actor-empty">
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!actor) {
    return (
      <div className="actor-page">
        <div className="actor-shell">
          <div className="actor-empty">
            <p>Actor not found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="actor-page">
      <div className="actor-shell">
        <section className="actor-hero">
          {actor.profile_url ? (
            <img
              src={actor.profile_url}
              alt={actor.name}
              className="actor-poster"
            />
          ) : (
            <div className="actor-poster actor-poster-empty">No image</div>
          )}

          <div className="actor-hero-main">
            <div className="actor-title-row">
              <h1 className="actor-title">{actor.name}</h1>
            </div>

            <div className="actor-meta">
              {actor.birthday ? (
                <div className="actor-meta-pill">
                  <span className="actor-meta-label">Born</span>
                  <span className="actor-meta-value">
                    {formatDate(actor.birthday)}
                  </span>
                </div>
              ) : null}

              {actor.place_of_birth ? (
                <div className="actor-meta-pill">
                  <span className="actor-meta-label">Place of birth</span>
                  <span className="actor-meta-value">
                    {actor.place_of_birth}
                  </span>
                </div>
              ) : null}

              <div className="actor-meta-pill">
                <span className="actor-meta-label">Shows</span>
                <span className="actor-meta-value">{credits.length}</span>
              </div>
            </div>

            {actor.biography ? (
              bioOpen ? (
                <>
                  <div className="actor-bio-dots-row">
                    <button
                      type="button"
                      className="actor-dots-plain"
                      onClick={toggleBio}
                      aria-label="Hide biography"
                      aria-expanded={bioOpen}
                    >
                      <span />
                      <span />
                      <span />
                    </button>
                  </div>

                  <div className="actor-bio-panel">
                    <p className="actor-overview">{actor.biography}</p>
                  </div>
                </>
              ) : (
                <div className="actor-bio-dots-row">
                  <button
                    type="button"
                    className="actor-dots-plain"
                    onClick={toggleBio}
                    aria-label="Show biography"
                    aria-expanded={bioOpen}
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                </div>
              )
            ) : null}
          </div>
        </section>

        <section className="actor-shows-section">
          <h2 className="actor-section-title">Shows</h2>

          {credits.length === 0 ? (
            <div className="actor-empty">
              <p>No TV shows found for this actor.</p>
            </div>
          ) : (
            <div className="actor-shows-list">
              {credits.map((show, index) => {
                const showName = show.name || "Unknown show";
                const resolvedTvdbId = getResolvedTvdbId(show);
                const resolvedTmdbId = getResolvedTmdbId(show);

                const savedByTvdb = Boolean(
                  resolvedTvdbId && savedTvdbLookup.has(String(resolvedTvdbId))
                );
                const savedByTmdb = Boolean(
                  resolvedTmdbId && savedTmdbLookup.has(String(resolvedTmdbId))
                );
                const alreadySaved = savedByTvdb || savedByTmdb;

                const canAdd = Boolean(resolvedTvdbId || resolvedTmdbId);
                const destinationHref = getShowDestination(
                  show,
                  savedByTvdb,
                  savedByTmdb
                );

                const showKey =
                  resolvedTvdbId ||
                  resolvedTmdbId ||
                  show.tmdb_id ||
                  show.id ||
                  `${showName}-${index}`;

                const addKey = resolvedTvdbId
                  ? `tvdb:${resolvedTvdbId}`
                  : resolvedTmdbId
                    ? `tmdb:${resolvedTmdbId}`
                    : null;

                const descriptionOpen = openShowDescriptionKey === showKey;
                const backdrop = getBackdrop(show);

                return (
                  <article
                    key={showKey}
                    className="actor-show-banner-card"
                    style={
                      backdrop
                        ? {
                            backgroundImage: `linear-gradient(90deg, rgba(10,16,28,0.92) 0%, rgba(10,16,28,0.84) 38%, rgba(10,16,28,0.92) 100%), url("${backdrop}")`,
                          }
                        : undefined
                    }
                  >
                    <div className="actor-show-banner-inner">
                      <div className="actor-show-poster-wrap">
                        <Link
                          to={destinationHref}
                          className="actor-show-poster-link"
                          aria-label={`Open ${showName}`}
                        >
                          {show.poster_url ? (
                            <img
                              src={show.poster_url}
                              alt={showName}
                              className="actor-show-poster"
                            />
                          ) : (
                            <div className="actor-show-poster actor-show-poster-placeholder">
                              No image
                            </div>
                          )}
                        </Link>
                      </div>

                      <div className="actor-show-content">
                        <Link to={destinationHref} className="actor-show-title-link">
                          <h3 className="actor-show-title">{showName}</h3>
                        </Link>

                        <div className="actor-show-meta">
                          {show.first_air_date ? (
                            <div className="actor-show-meta-row">
                              <span className="actor-show-meta-label">
                                First aired
                              </span>
                              <span className="actor-show-meta-value">
                                {formatDate(show.first_air_date)}
                              </span>
                            </div>
                          ) : null}

                          {show.character ? (
                            <div className="actor-show-meta-row">
                              <span className="actor-show-meta-label">
                                Character
                              </span>
                              <span className="actor-show-meta-value">
                                {show.character}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="actor-show-actions">
                          <div className="actor-show-dots-center">
                            {show.overview ? (
                              <button
                                type="button"
                                className="actor-dots-plain"
                                onClick={(event) =>
                                  toggleShowDescription(event, showKey)
                                }
                                aria-label={
                                  descriptionOpen
                                    ? "Hide show description"
                                    : "Show show description"
                                }
                                aria-expanded={descriptionOpen}
                              >
                                <span />
                                <span />
                                <span />
                              </button>
                            ) : null}
                          </div>

                          {canAdd ? (
                            alreadySaved ? (
                              <div className="actor-show-add-btn is-saved">
                                Added
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="actor-show-add-btn"
                                disabled={addingKey === addKey}
                                onClick={(event) => handleAddShow(event, show)}
                              >
                                {addingKey === addKey ? "Adding..." : "Add Show"}
                              </button>
                            )
                          ) : (
                            <div className="actor-show-add-btn is-missing">
                              Missing IDs
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {descriptionOpen && show.overview ? (
                      <div className="actor-show-description-panel">
                        <p className="actor-show-overview">{show.overview}</p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
