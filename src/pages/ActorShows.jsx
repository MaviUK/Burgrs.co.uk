import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addShowToUserList } from "../lib/userShows";
import { supabase } from "../lib/supabase";
import { fetchSavedShowRows, getSavedExternalIdSets } from "../lib/savedShowLibrary";
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

export default function ActorPage() {
  const { name } = useParams();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [name]);

  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState(null);
  const [credits, setCredits] = useState([]);
  const [error, setError] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());
  const [bioOpen, setBioOpen] = useState(false);
  const [openShowDescriptionKey, setOpenShowDescriptionKey] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedShows(candidateShows = []) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) setSavedIds(new Set());
        return;
      }

      try {
        const tvdbIds = (candidateShows || [])
          .map((show) => show?.resolved_tvdb_id || show?.tvdb_id)
          .filter(Boolean);
        const rows = await fetchSavedShowRows(user.id, { tvdbIds });
        const ids = getSavedExternalIdSets(rows).tvdb;

        if (!cancelled) {
          setSavedIds(ids);
        }
      } catch (error) {
        console.warn("Failed loading saved ids", error);
      }
    }

    async function loadActor() {
      setLoading(true);
      setError("");
      setBioOpen(false);
      setOpenShowDescriptionKey(null);

      try {
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

        const normalizedCredits = rawCredits.map((item) =>
          normalizeMappedShow({
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
          })
        );

        const actorPayload =
          data?.actor || buildFallbackActor(name, normalizedCredits);

        if (!cancelled) {
          setActor(actorPayload);
          setCredits(normalizedCredits);
        }

        await loadSavedShows(normalizedCredits);
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

    if (!show?.resolved_tvdb_id || addingId) return;

    setAddingId(show.resolved_tvdb_id);

    try {
      await addShowToUserList(show.resolved_tvdb_id);
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.add(String(show.resolved_tvdb_id));
        return next;
      });
    } catch (err) {
      console.error("Failed adding show", err);
      alert(err.message || "Failed to add show");
    } finally {
      setAddingId(null);
    }
  }

  function toggleShowDescription(event, key) {
    event.preventDefault();
    event.stopPropagation();
    setOpenShowDescriptionKey((prev) => (prev === key ? null : key));
  }

  function toggleBio(event) {
    event.preventDefault();
    setBioOpen((prev) => !prev);
  }

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

            {bioOpen && actor.biography ? (
              <div className="actor-bio-panel">
                <p className="actor-overview">{actor.biography}</p>
              </div>
            ) : actor.biography ? (
              <div className="actor-bio-hint">
                <span>Tap</span>
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
                <span>to view bio</span>
              </div>
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
                const href = getMappedShowHref(show);
                const canAdd = Boolean(show?.resolved_tvdb_id);
                const alreadySaved = canAdd
                  ? savedIds.has(String(show.resolved_tvdb_id))
                  : false;

                const showKey =
                  show.tmdb_id ||
                  show.id ||
                  show.resolved_tvdb_id ||
                  `${showName}-${index}`;

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
                    <Link to={href} className="actor-show-banner-link">
                      <div className="actor-show-banner-inner">
                        <div className="actor-show-poster-wrap">
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
                        </div>

                        <div className="actor-show-content">
                          <h3 className="actor-show-title">{showName}</h3>

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
                                <div
                                  className="actor-show-add-btn is-saved"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  Added
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="actor-show-add-btn"
                                  disabled={addingId === show.resolved_tvdb_id}
                                  onClick={(event) => handleAddShow(event, show)}
                                >
                                  {addingId === show.resolved_tvdb_id
                                    ? "Adding..."
                                    : "Add Show"}
                                </button>
                              )
                            ) : null}
                          </div>

                          {descriptionOpen && show.overview ? (
                            <div
                              className="actor-show-description-panel"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              <p className="actor-show-overview">
                                {show.overview}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
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
