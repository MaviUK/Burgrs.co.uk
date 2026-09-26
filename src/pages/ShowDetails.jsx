import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchShowExtrasCached } from "../lib/showExtrasCache";
import {
  fetchSeasonEpisodeDetailsCached,
  fetchShowCoreCached,
} from "../lib/showCoreCache";
import { formatDate } from "../lib/date";
import { addShowToUserList } from "../lib/userShows";
import "./MyShowDetails.css";
import {
  enrichTmdbShowsWithMappings,
  normalizeMappedShow,
} from "../lib/tmdbMappings";

function makeEpisodeCode(ep) {
  if (Number(ep?.seasonNumber) === 0) {
    if (!ep?.number) return "Special";
    return `Special ${ep.number}`;
  }

  if (!ep?.seasonNumber || !ep?.number) return "Episode";
  return `S${String(ep.seasonNumber).padStart(2, "0")}E${String(
    ep.number
  ).padStart(2, "0")}`;
}

function getYear(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getFullYear());
}

function sortSeasonGroups(a, b) {
  const aNum = Number(a[0]);
  const bNum = Number(b[0]);

  if (aNum === 0 && bNum !== 0) return -1;
  if (bNum === 0 && aNum !== 0) return 1;
  return aNum - bNum;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function resetShowState({
  setShow,
  setEpisodes,
  setExpandedSeasons,
  setCast,
  setCrew,
  setRecommendedShows,
  setMobileBannerUrl,
  setIsAdded,
}) {
  setShow(null);
  setEpisodes([]);
  setExpandedSeasons({});
  setCast([]);
  setCrew([]);
  setRecommendedShows([]);
  setMobileBannerUrl(null);
  setIsAdded(false);
}

function getBannerFromExtras(extras) {
  if (!extras || typeof extras !== "object") return null;

  return (
    extras.backdrop_url ||
    extras.backdropUrl ||
    extras.banner_url ||
    extras.bannerUrl ||
    extras.background_url ||
    extras.backgroundUrl ||
    extras.show?.backdrop_url ||
    extras.show?.banner_url ||
    extras.show?.background_url ||
    null
  );
}

function getBackdropUrl(showData) {
  return (
    showData?.backdrop_url ||
    showData?.background_url ||
    showData?.banner_url ||
    showData?.fanart_url ||
    showData?.image_url ||
    showData?.poster_url ||
    showData?.image ||
    null
  );
}

function getSafeTmdbRating(showData, extras) {
  const candidates = [
    extras?.tmdb_vote_average,
    extras?.tmdbRating,
    extras?.tmdb?.vote_average,
    extras?.tmdb?.rating,

    extras?.show?.tmdb_vote_average,
    extras?.show?.vote_average,
    extras?.show?.tmdb_rating,
    extras?.show?.rating_average,
    extras?.show?.score,

    extras?.series?.tmdb_vote_average,
    extras?.series?.vote_average,
    extras?.series?.tmdb_rating,
    extras?.series?.rating_average,
    extras?.series?.score,

    extras?.data?.tmdb_vote_average,
    extras?.data?.vote_average,
    extras?.data?.tmdb_rating,
    extras?.data?.rating_average,
    extras?.data?.score,

    showData?.tmdb_vote_average,
    showData?.tmdb_rating,
    showData?.vote_average,
    showData?.rating_average,
    showData?.score,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0 && num <= 10) {
      return num;
    }
  }

  return null;
}

function getSafeRankdRating(showData, extras) {
  const candidates = [
    showData?.rankd_average,
    showData?.average_rankd_rating,
    extras?.rankd_average,
    extras?.average_rankd_rating,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }

  return null;
}

function getPreferredEnglishName(showData, extras) {
  return (
    showData?.english_name ||
    showData?.name_eng ||
    showData?.english_title ||
    extras?.show?.english_name ||
    extras?.show?.name_eng ||
    extras?.show?.english_title ||
    extras?.series?.english_name ||
    extras?.series?.name_eng ||
    extras?.series?.english_title ||
    extras?.data?.english_name ||
    extras?.data?.name_eng ||
    extras?.data?.english_title ||
    showData?.name ||
    showData?.show_name ||
    "Unknown title"
  );
}

function getPreferredEnglishOverview(showData, extras) {
  return (
    showData?.overview_eng ||
    showData?.english_overview ||
    showData?.overview_english ||
    extras?.show?.overview_eng ||
    extras?.show?.english_overview ||
    extras?.show?.overview_english ||
    extras?.series?.overview_eng ||
    extras?.series?.english_overview ||
    extras?.series?.overview_english ||
    extras?.data?.overview_eng ||
    extras?.data?.english_overview ||
    extras?.data?.overview_english ||
    showData?.overview ||
    ""
  );
}

function normalizeShowPayload(showData, tvdbIdFallback, extras = null) {
  if (!showData) return null;

  const safeTmdbRating = getSafeTmdbRating(showData, extras);

  return {
    id: showData.id ?? null,
    tvdb_id: showData.tvdb_id ?? tvdbIdFallback ?? null,
    tmdb_id: showData.tmdb_id ?? null,
    show_name: getPreferredEnglishName(showData, extras),
    overview: getPreferredEnglishOverview(showData, extras),
    poster_url:
      showData.poster_url || showData.image_url || showData.image || null,
    backdrop_url: getBackdropUrl(showData),
    first_aired:
      showData.first_aired ||
      showData.first_air_date ||
      showData.first_air_time ||
      showData.firstAired ||
      null,
    status: showData.status || null,
    network: showData.network || "",
    original_language: showData.original_language || "",
    genres: Array.isArray(showData.genres)
      ? showData.genres.map((g) => (typeof g === "string" ? g : g?.name)).filter(Boolean)
      : [],
    relationship_types: Array.isArray(showData.relationship_types)
      ? showData.relationship_types
      : [],
    settings: Array.isArray(showData.settings) ? showData.settings : [],
    tmdb_rating: safeTmdbRating,
    rating_average: safeTmdbRating,
    rating_count:
      showData.rating_count != null ? Number(showData.rating_count) : null,
    rankd_average: getSafeRankdRating(showData, extras),
  };
}

function normalizeEpisodePayload(row, index, fallbackId) {
  return {
    id:
      row.id ||
      row.tvdb_id ||
      row.tvdbId ||
      `${fallbackId}-${row.season_number ?? row.seasonNumber ?? row.season_number ?? 0}-${
        row.episode_number ?? row.number ?? 0
      }-${index}`,
    tvdb_episode_id: row.tvdb_id || row.tvdbId || null,
    seasonNumber: row.season_number ?? row.seasonNumber ?? 0,
    number: row.episode_number ?? row.number ?? 0,
    aired: row.aired_date || row.airDate || row.air_date || row.aired || null,
    airDate: row.aired_date || row.airDate || row.air_date || row.aired || null,
    name: row.name || "Untitled episode",
    overview: row.overview || "",
    image:
      row.image_url ||
      row.image ||
      row.still_url ||
      row.still_path ||
      row.tmdb_still_path ||
      null,
    episode_code: row.episode_code || null,
  };
}

function normalizeTmdbExtras(data) {
  if (!data || typeof data !== "object") return null;

  const cast = Array.isArray(data.cast)
    ? data.cast.map((member) => ({
        id: member?.id ?? null,
        personName: member?.name || "Unknown actor",
        character: member?.character || "",
        image: member?.profile_path
          ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
          : member?.image || null,
      }))
    : [];

  const crew = Array.isArray(data.crew)
    ? data.crew.map((member) => ({
        id: member?.id ?? null,
        personName: member?.name || "Unknown crew",
        job: member?.job || "",
        image: member?.profile_path
          ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
          : member?.image || null,
      }))
    : [];

  const episodes = [];
  if (Array.isArray(data.seasons)) {
    data.seasons.forEach((season) => {
      const seasonNum = Number(season?.season_number ?? 0);
      const count = Number(season?.episode_count ?? 0);

      for (let i = 1; i <= count; i += 1) {
        episodes.push({
          id: `${data.tmdb_id || data.id}-${seasonNum}-${i}`,
          season_number: seasonNum,
          episode_number: i,
          name: `Episode ${i}`,
          overview: "",
          aired_date: season?.air_date || null,
          image_url: null,
        });
      }
    });
  }

  return {
    show: {
      id: data.id ?? data.tmdb_id ?? null,
      tmdb_id: data.tmdb_id ?? data.id ?? null,
      tvdb_id: data.tvdb_id ?? null,
      name: data.name || "Unknown title",
      show_name: data.name || "Unknown title",
      overview: data.overview || "",
      poster_url: data.poster_url || null,
      backdrop_url: data.backdrop_url || null,
      first_air_date: data.first_air_date || null,
      first_aired: data.first_air_date || null,
      status: data.status || null,
      network:
        Array.isArray(data.networks) && data.networks.length > 0
          ? data.networks
              .map((item) => item?.name)
              .filter(Boolean)
              .join(", ")
          : "",
      original_language: data.original_language || "",
      genres: Array.isArray(data.genres)
        ? data.genres.map((g) => g?.name).filter(Boolean)
        : [],
      tmdb_vote_average: data.vote_average ?? null,
    },
    banner_url: data.backdrop_url || null,
    cast,
    crew,
    episodes,
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
  };
}

export default function ShowDetails() {
  const { id, tmdbId } = useParams();
  const navigate = useNavigate();
  const isTmdbFallback = Boolean(tmdbId);

  const [loading, setLoading] = useState(true);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const [show, setShow] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [expandedSeasons, setExpandedSeasons] = useState({});
  const [cast, setCast] = useState([]);
  const [crew, setCrew] = useState([]);
  const [recommendedShows, setRecommendedShows] = useState([]);
  const [mobileBannerUrl, setMobileBannerUrl] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [isAdded, setIsAdded] = useState(false);
  const [expandedOverview, setExpandedOverview] = useState(false);
  const [activeTab, setActiveTab] = useState("seasons");
  const [expandedEpisodeOverviewIds, setExpandedEpisodeOverviewIds] = useState(
    {}
  );

  useEffect(() => {
    async function loadShow() {
      setLoading(true);
      setExtrasLoading(false);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user || null;

        setViewer(user);

        const routeId = String(id || "");
        const numericTvdbId = Number(id);
        const numericTmdbId = Number(tmdbId);
        const hasNumericTvdbId = Number.isFinite(numericTvdbId);
        const hasNumericTmdbId = Number.isFinite(numericTmdbId);

        if (!isTmdbFallback && !routeId) {
          resetShowState({
            setShow,
            setEpisodes,
            setExpandedSeasons,
            setCast,
            setCrew,
            setRecommendedShows,
            setMobileBannerUrl,
            setIsAdded,
          });
          return;
        }

        if (isTmdbFallback && !hasNumericTmdbId) {
          resetShowState({
            setShow,
            setEpisodes,
            setExpandedSeasons,
            setCast,
            setCrew,
            setRecommendedShows,
            setMobileBannerUrl,
            setIsAdded,
          });
          return;
        }

        let dbShow = null;
        let dbEpisodes = [];
        let extras = null;

        async function attachDatabaseShow(
          showData,
          fallbackId,
          prefetchedEpisodeRows = null
        ) {
          if (!showData) return;
          dbShow = showData;

          const userShowPromise = user
            ? supabase
                .from("user_shows_new")
                .select("id")
                .eq("user_id", user.id)
                .eq("show_id", showData.id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null });

          const episodePromise = Array.isArray(prefetchedEpisodeRows)
            ? Promise.resolve({ data: prefetchedEpisodeRows, error: null })
            : supabase
                .from("episodes")
                .select(`
                  id,
                  tvdb_id,
                  show_id,
                  season_number,
                  episode_number,
                  episode_code,
                  name,
                  aired_date
                `)
                .eq("show_id", showData.id)
                .order("season_number", { ascending: true })
                .order("episode_number", { ascending: true });

          const [
            { data: userShowData, error: userShowError },
            { data: episodeRows, error: episodeError },
          ] = await Promise.all([userShowPromise, episodePromise]);

          if (userShowError) {
            console.warn("user show fetch failed", userShowError);
          }

          setIsAdded(!!userShowData);

          if (episodeError) throw episodeError;

          dbEpisodes = (episodeRows || []).map((row, index) =>
            normalizeEpisodePayload(
              row,
              index,
              fallbackId || showData.tvdb_id || showData.tmdb_id || showData.id
            )
          );
        }

        function renderDatabaseShowImmediately(showData, fallbackId) {
          if (!showData) return;

          const normalizedShow = normalizeShowPayload(
            showData,
            showData.tvdb_id || fallbackId || null,
            null
          );

          if (!normalizedShow) return;

          const seasonMap = {};
          dbEpisodes.forEach((ep) => {
            const seasonKey = Number(ep.seasonNumber ?? 0);
            if (seasonKey === 0) return;
            if (!(seasonKey in seasonMap)) seasonMap[seasonKey] = false;
          });

          setShow({
            ...normalizedShow,
            trailer: null,
            is_tmdb_fallback: false,
          });
          setEpisodes(dbEpisodes);
          setExpandedSeasons(seasonMap);
          setCast([]);
          setCrew([]);
          setRecommendedShows([]);
          setMobileBannerUrl(normalizedShow.backdrop_url || null);
          setExpandedOverview(false);
          setActiveTab("seasons");

          // The core show already exists locally, so don't make the first
          // render wait for slower TVDB/TMDB enrichment.
          setLoading(false);
        }

        if (!isTmdbFallback) {
          let showData = null;

          let prefetchedEpisodeRows = null;

          if (hasNumericTvdbId) {
            const core = await fetchShowCoreCached({
              source: "tvdb",
              id: numericTvdbId,
            });
            showData = core.show || null;
            prefetchedEpisodeRows = core.episodes || [];
          }

          if (!showData && isUuid(routeId)) {
            const { data, error: showError } = await supabase
              .from("shows")
              .select(`*`)
              .eq("id", routeId)
              .maybeSingle();

            if (showError) throw showError;
            showData = data || null;
          }

          if (showData) {
            await attachDatabaseShow(
              showData,
              showData.tvdb_id || numericTvdbId || showData.tmdb_id,
              prefetchedEpisodeRows
            );
            renderDatabaseShowImmediately(
              showData,
              showData.tvdb_id || numericTvdbId || showData.tmdb_id
            );
          } else {
            setIsAdded(false);
          }

          const extrasTvdbId = showData?.tvdb_id || (hasNumericTvdbId ? numericTvdbId : null);

          if (extrasTvdbId) {
            try {
              setExtrasLoading(true);

              extras = await fetchShowExtrasCached({
                source: "tvdb",
                id: extrasTvdbId,
              });
            } catch (extrasError) {
              console.error("Failed loading TVDB extras:", extrasError);
            } finally {
              setExtrasLoading(false);
            }
          }
        } else {
          const core = await fetchShowCoreCached({
            source: "tmdb",
            id: numericTmdbId,
          });
          const showData = core.show || null;

          if (showData) {
            await attachDatabaseShow(
              showData,
              showData.tvdb_id || numericTmdbId,
              core.episodes || []
            );
            renderDatabaseShowImmediately(
              showData,
              showData.tvdb_id || numericTmdbId
            );
          } else {
            setIsAdded(false);
          }

          try {
            setExtrasLoading(true);

            const tmdbData = await fetchShowExtrasCached({
              source: "tmdb",
              id: numericTmdbId,
            });
            extras = normalizeTmdbExtras(tmdbData);
          } catch (extrasError) {
            console.error("Failed loading TMDB extras:", extrasError);
          } finally {
            setExtrasLoading(false);
          }
        }

        const fallbackShow =
          extras?.show_english ||
          extras?.english_show ||
          extras?.show ||
          extras?.series_english ||
          extras?.series ||
          extras?.data_english ||
          extras?.data ||
          null;

        const normalizedShow = normalizeShowPayload(
          dbShow || fallbackShow,
          dbShow?.tvdb_id || (!isTmdbFallback && hasNumericTvdbId ? numericTvdbId : null),
          extras
        );

        if (!normalizedShow) {
          resetShowState({
            setShow,
            setEpisodes,
            setExpandedSeasons,
            setCast,
            setCrew,
            setRecommendedShows,
            setMobileBannerUrl,
            setIsAdded,
          });
          return;
        }

        if (isTmdbFallback && numericTmdbId) {
          normalizedShow.tmdb_id = normalizedShow.tmdb_id || numericTmdbId;
        }

        if (dbShow?.tvdb_id) {
          normalizedShow.tvdb_id = dbShow.tvdb_id;
        }

        const fallbackEpisodes = Array.isArray(extras?.episodes)
          ? extras.episodes
          : [];

        const normalizedEpisodes =
          dbEpisodes.length > 0
            ? dbEpisodes
            : fallbackEpisodes.map((row, index) =>
                normalizeEpisodePayload(
                  row,
                  index,
                  dbShow?.tvdb_id || (isTmdbFallback ? numericTmdbId : numericTvdbId)
                )
              );

        const seasonMap = {};
        normalizedEpisodes.forEach((ep) => {
          const seasonKey = Number(ep.seasonNumber ?? 0);
          if (seasonKey === 0) return;
          if (!(seasonKey in seasonMap)) seasonMap[seasonKey] = false;
        });

        const castRows = Array.isArray(extras?.cast) ? extras.cast : [];
        const crewRows = Array.isArray(extras?.crew) ? extras.crew : [];
        const fallbackRecommendations = Array.isArray(extras?.recommendations)
          ? extras.recommendations
          : [];
        const trailerData = extras?.trailer || null;

        let mappedRecommendations = [];

        try {
          mappedRecommendations = await enrichTmdbShowsWithMappings(
            fallbackRecommendations
          );
        } catch (mappingError) {
          console.error("Failed mapping recommendations:", mappingError);
          mappedRecommendations = fallbackRecommendations;
        }

        setShow({
          ...normalizedShow,
          trailer: trailerData,
          is_tmdb_fallback: isTmdbFallback && !dbShow,
        });
        setEpisodes(normalizedEpisodes);
        setExpandedSeasons(seasonMap);
        setCast(castRows);
        setCrew(crewRows);
        setRecommendedShows(mappedRecommendations);
        setMobileBannerUrl(getBannerFromExtras(extras) || normalizedShow.backdrop_url || null);
        setExpandedOverview(false);
        setActiveTab("seasons");
      } catch (err) {
        console.error("Failed loading show:", err);
        setError(err.message || "Failed loading show");
        resetShowState({
          setShow,
          setEpisodes,
          setExpandedSeasons,
          setCast,
          setCrew,
          setRecommendedShows,
          setMobileBannerUrl,
          setIsAdded,
        });
      } finally {
        setLoading(false);
      }
    }

    loadShow();
  }, [id, tmdbId, isTmdbFallback]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [id, tmdbId]);

  const groupedSeasons = useMemo(() => {
    const grouped = {};

    for (const ep of episodes) {
      const seasonKey = Number(ep.seasonNumber ?? 0);
      if (seasonKey === 0) continue;
      if (!grouped[seasonKey]) grouped[seasonKey] = [];
      grouped[seasonKey].push(ep);
    }

    return Object.entries(grouped)
      .sort(sortSeasonGroups)
      .map(([seasonNumber, seasonEpisodes]) => ({
        seasonNumber: Number(seasonNumber),
        label: `Season ${seasonNumber}`,
        episodes: seasonEpisodes,
        totalCount: seasonEpisodes.length,
      }));
  }, [episodes]);

  const stats = useMemo(() => {
    const mainEpisodes = episodes.filter(
      (ep) => Number(ep.seasonNumber ?? 0) !== 0
    );

    return {
      total: mainEpisodes.length,
      totalSeasons: groupedSeasons.length,
    };
  }, [episodes, groupedSeasons]);

  const sourceYear = getYear(show?.first_aired);
  const sourceRating =
    show?.rating_average != null && !Number.isNaN(Number(show.rating_average))
      ? Number(show.rating_average).toFixed(1)
      : "";
  const sourceLanguage = show?.original_language || "";

  const tmdbRating =
    show?.tmdb_rating != null && !Number.isNaN(Number(show.tmdb_rating))
      ? Number(show.tmdb_rating).toFixed(1)
      : show?.rating_average != null &&
        !Number.isNaN(Number(show.rating_average))
      ? Number(show.rating_average).toFixed(1)
      : "—";

  const rankdRating =
    show?.rankd_average != null && !Number.isNaN(Number(show.rankd_average))
      ? Number(show.rankd_average).toFixed(1)
      : "—";

  const baseContext = `sourceShowId=${encodeURIComponent(
    show?.tvdb_id || show?.tmdb_id || ""
  )}&sourceYear=${encodeURIComponent(
    sourceYear
  )}&sourceRating=${encodeURIComponent(
    sourceRating
  )}&sourceLanguage=${encodeURIComponent(sourceLanguage)}`;

  useEffect(() => {
    if (!show) return undefined;

    const frame = window.requestAnimationFrame(() => {
      document.dispatchEvent(
        new CustomEvent("burgrs:show-page-ready", {
          detail: {
            saved: false,
            showId: show.id,
            extrasLoading,
          },
        })
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [show, episodes, extrasLoading]);

  async function hydrateSeasonEpisodeDetails(seasonNumber) {
    if (!show?.id) return;

    try {
      const rows = await fetchSeasonEpisodeDetailsCached(
        show.id,
        seasonNumber
      );

      const detailsById = new Map(
        rows.map((row, index) => [
          String(row.id),
          normalizeEpisodePayload(
            row,
            index,
            show.tvdb_id || show.tmdb_id || show.id
          ),
        ])
      );

      setEpisodes((current) =>
        current.map((episode) => {
          const details = detailsById.get(String(episode.id));
          return details ? { ...episode, ...details } : episode;
        })
      );
    } catch (error) {
      console.warn("Season episode details unavailable", error);
    }
  }

  function toggleSeason(seasonNumber) {
    const willOpen = !expandedSeasons[seasonNumber];

    setExpandedSeasons((prev) => ({
      ...prev,
      [seasonNumber]: !prev[seasonNumber],
    }));

    if (willOpen) {
      void hydrateSeasonEpisodeDetails(seasonNumber);
    }
  }

  async function handleAddShow() {
    if (!viewer) {
      setError("Please log in to add this show.");
      return;
    }

    if (!show?.tvdb_id && !show?.tmdb_id) {
      setError("This show cannot be added yet because it has no supported id.");
      return;
    }

    setAdding(true);
    setError("");

    try {
      await addShowToUserList({
        tvdb_id: show?.tvdb_id ? Number(show.tvdb_id) : null,
        tmdb_id: show?.tmdb_id ? Number(show.tmdb_id) : null,
        id: show?.tvdb_id
          ? Number(show.tvdb_id)
          : show?.tmdb_id
            ? Number(show.tmdb_id)
            : null,
        name: show.show_name || "Unknown Show",
        poster_url: show.poster_url || null,
        backdrop_url: show.backdrop_url || null,
        overview: show.overview || null,
        first_air_date: show.first_aired || null,
        first_aired: show.first_aired || null,
        status: show.status || null,
        source: show?.is_tmdb_fallback ? "tmdb" : "tvdb",
      });

      setIsAdded(true);

      if (show?.tvdb_id) {
        navigate(`/my-shows/${show.tvdb_id}`, { replace: true });
      } else if (show?.tmdb_id) {
        navigate(`/my-shows/tmdb/${show.tmdb_id}`, { replace: true });
      }
    } catch (err) {
      console.error("Failed to add show:", err);
      setError(err.message || "Failed to add show.");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="msd-page">
        <div className="msd-shell">
          <div className="msd-loading">Loading show...</div>
        </div>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="msd-page">
        <div className="msd-shell">
          <div className="msd-empty">
            <p>{error || "Show not found."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msd-page">
      <div className="msd-shell">
        <section className="msd-mobile-banner-wrap">
          <div
            className={`msd-mobile-banner ${
              mobileBannerUrl ? "" : "msd-mobile-banner-fallback"
            }`}
            style={
              mobileBannerUrl
                ? { backgroundImage: `url(${mobileBannerUrl})` }
                : undefined
            }
          />
        </section>

        <section className="msd-hero">
          <div className="msd-hero-poster-wrap">
            {show.poster_url ? (
              <img
                src={show.poster_url}
                alt={show.show_name}
                className="msd-poster"
              />
            ) : null}
          </div>

          <div className="msd-hero-main msd-hero-main-mobile">
            <div className="msd-mobile-top-row">
              <div className="msd-mobile-title-wrap">
                <h1 className="msd-title">{show.show_name}</h1>
                {show.first_aired ? (
                  <>
                    <div className="msd-mobile-year">
                      {new Date(show.first_aired).getFullYear()}
                    </div>
                    <div className="msd-mobile-first-aired">
                      First aired: {formatDate(show.first_aired)}
                    </div>
                  </>
                ) : null}
              </div>

              {show.poster_url ? (
                <img
                  src={show.poster_url}
                  alt={show.show_name}
                  className="msd-mobile-thumb"
                />
              ) : null}
            </div>

            {show.overview ? (
              <div className="msd-overview-wrapper">
                <p
                  className={`msd-overview msd-overview-mobile ${
                    expandedOverview ? "expanded" : "collapsed"
                  }`}
                >
                  {show.overview}
                </p>

                <button
                  type="button"
                  className="msd-overview-dots"
                  onClick={() => setExpandedOverview((prev) => !prev)}
                  aria-label={
                    expandedOverview ? "Collapse overview" : "Expand overview"
                  }
                >
                  •••
                </button>
              </div>
            ) : null}

            <div className="msd-stats-row msd-stats-row-top msd-stats-row-four">
              <div className="msd-stat-box">
                <span className="msd-stat-label">Seasons</span>
                <strong className="msd-stat-value">{stats.totalSeasons}</strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Episodes</span>
                <strong className="msd-stat-value">{stats.total}</strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Rating</span>
                <strong className="msd-stat-value">{tmdbRating}</strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Rank'd</span>
                <strong className="msd-stat-value">{rankdRating}</strong>
              </div>
            </div>

            {error ? (
              <p style={{ color: "#fca5a5", marginTop: "14px" }}>{error}</p>
            ) : null}
          </div>
        </section>

        <section className="msd-content-tabs-section">
          <div
            className="msd-content-tabs"
            role="tablist"
            aria-label="Show sections"
          >
            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "seasons" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("seasons")}
            >
              Seasons
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "cast" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("cast")}
            >
              Cast
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "crew" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("crew")}
            >
              Crew
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "studio" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("studio")}
            >
              Studio
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "genre" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("genre")}
            >
              Genre
            </button>
          </div>

          <div className="msd-tab-panel">
            {activeTab === "seasons" && (
              <>
                <h2 className="msd-section-title">Seasons</h2>
                <div className="msd-seasons">
                  {groupedSeasons.map((season) => (
                    <section
                      key={season.seasonNumber}
                      className="msd-season-card"
                    >
                      <button
                        type="button"
                        className="msd-season-toggle"
                        onClick={() => toggleSeason(season.seasonNumber)}
                      >
                        <div>
                          <div className="msd-season-title">{season.label}</div>
                          <div className="msd-season-subtitle">
                            {season.totalCount} episodes
                          </div>
                        </div>
                        <div className="msd-season-toggle-right">
                          <span className="msd-season-chevron">
                            {expandedSeasons[season.seasonNumber] ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {expandedSeasons[season.seasonNumber] && (
                        <div className="msd-episode-list">
                          {season.episodes.map((ep) => {
                            const isExpanded =
                              !!expandedEpisodeOverviewIds[ep.id];

                            return (
                              <article key={ep.id} className="msd-episode-card">
                                <div
                                  className={`msd-episode-hero ${
                                    ep.image ? "" : "msd-episode-hero-fallback"
                                  }`}
                                  style={
                                    ep.image
                                      ? { backgroundImage: `url(${ep.image})` }
                                      : undefined
                                  }
                                >
                                  <div className="msd-episode-hero-overlay">
                                    <div className="msd-episode-hero-text">
                                      <h3 className="msd-episode-hero-title">
                                        {makeEpisodeCode(ep)} - {ep.name}
                                      </h3>
                                      <div className="msd-episode-hero-date">
                                        Air date: {formatDate(ep.aired)}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  className="msd-episode-more-btn"
                                  onClick={() =>
                                    setExpandedEpisodeOverviewIds((prev) => ({
                                      ...prev,
                                      [ep.id]: !prev[ep.id],
                                    }))
                                  }
                                  aria-label={
                                    isExpanded
                                      ? "Hide episode overview"
                                      : "Show episode overview"
                                  }
                                >
                                  •••
                                </button>

                                {isExpanded && ep.overview ? (
                                  <p className="msd-episode-overview msd-episode-overview-mobile-card">
                                    {ep.overview}
                                  </p>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </>
            )}

            {activeTab === "cast" && (
              <>
                <h2 className="msd-section-title">Cast</h2>
                {extrasLoading ? (
                  <p className="msd-muted">Loading cast...</p>
                ) : cast.length > 0 ? (
                  <div className="msd-cast-grid msd-cast-grid-mobile">
                    {cast.map((member, index) => (
                      <div
                        key={member.id || `${member.personName}-${index}`}
                        className="msd-cast-card msd-cast-card-mobile"
                      >
                        {member.image ? (
                          <img
                            src={member.image}
                            alt={member.personName || "Cast member"}
                            className="msd-cast-image msd-cast-image-mobile"
                          />
                        ) : (
                          <div className="msd-cast-image msd-cast-image-mobile msd-cast-placeholder" />
                        )}
                        <div className="msd-cast-name">
                          {member.personName || "Unknown actor"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="msd-muted">No cast available.</p>
                )}
              </>
            )}

            {activeTab === "crew" && (
              <>
                <h2 className="msd-section-title">Crew</h2>
                {extrasLoading ? (
                  <p className="msd-muted">Loading crew...</p>
                ) : crew.length > 0 ? (
                  <div className="msd-cast-grid msd-cast-grid-mobile">
                    {crew.map((member, index) => {
                      const personName = member.personName || "Unknown crew";

                      return (
                        <div
                          key={member.id || `${personName}-${index}`}
                          className="msd-cast-card msd-cast-card-mobile"
                        >
                          {member.image ? (
                            <img
                              src={member.image}
                              alt={personName}
                              className="msd-cast-image msd-cast-image-mobile"
                            />
                          ) : (
                            <div className="msd-cast-image msd-cast-image-mobile msd-cast-placeholder" />
                          )}
                          <div className="msd-cast-name">{personName}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="msd-muted">No crew available yet.</p>
                )}
              </>
            )}

            {activeTab === "studio" && (
              <>
                <h2 className="msd-section-title">Studio</h2>
                <div className="msd-info-grid">
                  <div className="msd-info-card">
                    <span className="msd-stat-label">Studio</span>
                    <strong className="msd-stat-value">
                      {show.network ? (
                        <Link
                          to={`/search?network=${encodeURIComponent(
                            show.network
                          )}&${baseContext}`}
                          className="msd-link"
                        >
                          {show.network}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </strong>
                  </div>
                </div>
              </>
            )}

            {activeTab === "genre" && (
              <>
                <h2 className="msd-section-title">Genre</h2>
                <div className="msd-info-grid">
                  {show.genres?.length > 0 ? (
                    show.genres.map((genre) => (
                      <div key={genre} className="msd-info-card">
                        <Link
                          to={`/search?genre=${encodeURIComponent(
                            genre
                          )}&${baseContext}`}
                          className="msd-link msd-info-link"
                        >
                          {genre}
                        </Link>
                      </div>
                    ))
                  ) : (
                    <p className="msd-muted">No genres available.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="msd-panel">
          <h2 className="msd-section-title">Recommended Shows</h2>
          {extrasLoading ? (
            <p className="msd-muted">Loading recommendations...</p>
          ) : recommendedShows.length > 0 ? (
            <div className="msd-recommended-row">
              {recommendedShows.map((rec, index) => {
                const mapped = normalizeMappedShow(rec);
                const recTvdbId =
                  mapped?.resolved_tvdb_id || mapped?.tvdb_id || mapped?.tvdbId;
                const recTmdbId = mapped?.tmdb_id || mapped?.id;

                const showName = mapped?.name || mapped?.title || "Unknown show";
                const posterSrc =
                  mapped?.poster_url ||
                  mapped?.posterUrl ||
                  mapped?.image_url ||
                  mapped?.image ||
                  (mapped?.poster_path
                    ? `https://image.tmdb.org/t/p/w500${mapped.poster_path}`
                    : "");

                const href = recTvdbId
                  ? `/show/${recTvdbId}`
                  : recTmdbId
                    ? `/show/tmdb/${recTmdbId}`
                    : null;

                if (!href) {
                  return (
                    <div
                      key={mapped?.id || `${showName}-${index}`}
                      className="msd-recommended-card"
                    >
                      {posterSrc ? (
                        <img
                          src={posterSrc}
                          alt={showName}
                          className="msd-recommended-card-image"
                        />
                      ) : (
                        <div className="msd-recommended-card-image-placeholder">
                          {showName.charAt(0)}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={mapped?.id || `${showName}-${index}`}
                    to={href}
                    className="msd-recommended-card"
                  >
                    {posterSrc ? (
                      <img
                        src={posterSrc}
                        alt={showName}
                        className="msd-recommended-card-image"
                      />
                    ) : (
                      <div className="msd-recommended-card-image-placeholder">
                        {showName.charAt(0)}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="msd-muted">No recommendations yet.</p>
          )}
        </section>

        {!isAdded ? (
          <div className="msd-bottom-action-bar">
            <button
              type="button"
              className="msd-bottom-action-btn msd-bottom-action-btn-primary"
              onClick={handleAddShow}
              disabled={adding}
            >
              {adding ? "Adding..." : "Add to My Shows"}
            </button>
          </div>
        ) : (
          <div className="msd-bottom-action-bar">
            {show.tvdb_id ? (
              <Link
                to={`/my-shows/${show.tvdb_id}`}
                className="msd-bottom-action-btn msd-bottom-action-btn-primary"
                style={{
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Open in My Shows
              </Link>
            ) : show.tmdb_id ? (
              <Link
                to={`/show/tmdb/${show.tmdb_id}`}
                className="msd-bottom-action-btn msd-bottom-action-btn-primary"
                style={{
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Open Show
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
