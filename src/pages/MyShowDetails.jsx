import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchShowExtrasCached } from "../lib/showExtrasCache";
import {
  fetchSeasonEpisodeDetailsCached,
  fetchShowCoreCached,
} from "../lib/showCoreCache";
import ShowReviews from "../components/ShowReviews";
import EpisodeReviews from "../components/EpisodeReviews";
import ShowChatBoard from "../components/ShowChatBoard";
import { formatDate } from "../lib/date";
import "./MyShowDetails.css";
import {
  enrichTmdbShowsWithMappings,
  getMappedShowHref,
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

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function createWatchedLookup(rows, assumeAllWatched = false) {
  return {
    assumeAllWatched,
    byEpisodeId: new Set(
      (rows || [])
        .map((row) => row?.episode_id)
        .filter(Boolean)
        .map(String)
    ),
  };
}

function isEpisodeWatched(ep, watchedLookup) {
  if (!ep?.id) return false;
  if (watchedLookup?.assumeAllWatched) return true;
  return watchedLookup.byEpisodeId.has(String(ep.id));
}

function isFuture(dateString) {
  if (!dateString) return false;
  const d = new Date(dateString);
  return !Number.isNaN(d.getTime()) && d > new Date();
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

function sortRankings(a, b) {
  const aRating = Number(a?.rating ?? 1200);
  const bRating = Number(b?.rating ?? 1200);

  if (bRating !== aRating) return bRating - aRating;

  const aWins = Number(a?.wins ?? 0);
  const bWins = Number(b?.wins ?? 0);

  if (bWins !== aWins) return bWins - aWins;

  const aName = String(a?.show_name || "");
  const bName = String(b?.show_name || "");

  return aName.localeCompare(bName);
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

async function fetchWatchedRowsForEpisodeIds(episodeIds, userId) {
  if (!episodeIds?.length || !userId) return [];

  const batches = chunkArray(episodeIds, 100);
  const allRows = [];

  for (const batch of batches) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("user_id, episode_id")
      .eq("user_id", userId)
      .in("episode_id", batch);

    if (error) throw error;
    allRows.push(...(data || []));
  }

  return allRows;
}

async function fetchBurgrRatings(showId) {
  const { data, error } = await supabase
    .from("burgr_ratings")
    .select("user_id, show_id, rating")
    .eq("show_id", showId);

  if (error) {
    console.warn("burgr_ratings load failed:", error);
    return [];
  }

  return data || [];
}

async function fetchAllEpisodeRatingsForShowEpisodeIds(showEpisodeIds) {
  if (!showEpisodeIds?.length) return [];

  const batches = chunkArray(showEpisodeIds, 100);
  const allRows = [];

  for (const batch of batches) {
    const { data, error } = await supabase
      .from("episode_ratings")
      .select("user_id, episode_id, rating")
      .in("episode_id", batch);

    if (error) {
      console.warn("episode_ratings load failed:", error);
      return [];
    }

    allRows.push(...(data || []));
  }

  return allRows;
}

function buildEpisodeRatingsMap(rows, userId) {
  const map = new Map();

  for (const row of rows || []) {
    if (!row?.episode_id) continue;
    if (row.user_id !== userId) continue;
    map.set(String(row.episode_id), String(row.rating));
  }

  return map;
}

function buildEpisodeAverageRatingsMap(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const episodeId = String(row?.episode_id || "");
    const rating = Number(row?.rating);

    if (!episodeId || Number.isNaN(rating)) continue;

    if (!grouped.has(episodeId)) grouped.set(episodeId, []);
    grouped.get(episodeId).push(rating);
  }

  const averages = new Map();

  for (const [episodeId, ratings] of grouped.entries()) {
    const avg = ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
    averages.set(episodeId, {
      avg: avg.toFixed(1),
      count: ratings.length,
    });
  }

  return averages;
}

function emptyState() {
  return {
    show: null,
    episodes: [],
    watchedRows: [],
    communityWatchedRows: [],
    expandedSeasons: {},
    cast: [],
    crew: [],
    recommendedShows: [],
    peopleAlsoWatch: [],
    savedShowTvdbIds: new Set(),
    burgrRatings: [],
    myBurgrRating: "",
    episodeRatings: [],
    savingEpisodeRatingId: null,
    hoverEpisodeRatings: {},
    openEpisodeRatingPickerId: null,
    openEpisodeReviewId: null,
    mobileBannerUrl: null,
    rankPosition: null,
    watchProviders: null,
  };
}

export default function MyShowDetails() {
  const { id, tmdbId } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const targetEpisodeId = searchParams.get("episode");
  const isTmdbRoute = location.pathname.startsWith("/my-shows/tmdb/");
  const routeId = isTmdbRoute ? tmdbId : id;

  const [loading, setLoading] = useState(true);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [savingBurgr, setSavingBurgr] = useState(false);
  const [savingShowAction, setSavingShowAction] = useState(false);
  const [watchedLoaded, setWatchedLoaded] = useState(false);

  const [show, setShow] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [watchedRows, setWatchedRows] = useState([]);
  const [communityWatchedRows, setCommunityWatchedRows] = useState([]);
  const [expandedSeasons, setExpandedSeasons] = useState({});

  const [cast, setCast] = useState([]);
  const [crew, setCrew] = useState([]);
  const [recommendedShows, setRecommendedShows] = useState([]);
  const [peopleAlsoWatch, setPeopleAlsoWatch] = useState([]);
  const [savedShowTvdbIds, setSavedShowTvdbIds] = useState(new Set());

  const [burgrRatings, setBurgrRatings] = useState([]);
  const [myBurgrRating, setMyBurgrRating] = useState("");
  const [draftBurgrRating, setDraftBurgrRating] = useState("");

  const [currentUserId, setCurrentUserId] = useState(null);
  const [episodeRatings, setEpisodeRatings] = useState([]);
  const [savingEpisodeRatingId, setSavingEpisodeRatingId] = useState(null);
  const [hoverEpisodeRatings, setHoverEpisodeRatings] = useState({});
  const [openEpisodeRatingPickerId, setOpenEpisodeRatingPickerId] =
    useState(null);
  const [openEpisodeReviewId, setOpenEpisodeReviewId] = useState(null);
  const [mobileBannerUrl, setMobileBannerUrl] = useState(null);
  const [expandedOverview, setExpandedOverview] = useState(false);
  const overviewRef = useRef(null);
const [hasOverflow, setHasOverflow] = useState(false);
  const [activeTab, setActiveTab] = useState("seasons");
  const [chatBoardOpen, setChatBoardOpen] = useState(false);
  const contentTabsSectionRef = useRef(null);

const burgrTouchRef = useRef({
  startX: 0,
  startY: 0,
  horizontalDrag: false,
});
  const [rankPosition, setRankPosition] = useState(null);
  const [watchProviders, setWatchProviders] = useState(null);
  const [watchOptionsOpen, setWatchOptionsOpen] = useState(false);
  const [expandedEpisodeOverviewIds, setExpandedEpisodeOverviewIds] = useState(
    {}
  );
  const loadedEpisodeRatingSeasonsRef = useRef(new Set());

  const watchedLookup = useMemo(
    () => createWatchedLookup(watchedRows, show?.watch_status === "completed"),
    [watchedRows, show?.watch_status]
  );

  const myEpisodeRatings = useMemo(
    () => buildEpisodeRatingsMap(episodeRatings, currentUserId),
    [episodeRatings, currentUserId]
  );

  const episodeAverageRatings = useMemo(
    () => buildEpisodeAverageRatingsMap(episodeRatings),
    [episodeRatings]
  );

  const allWatchProviders = useMemo(() => {
    if (!watchProviders) return [];

    const seen = new Set();

    return [
      ...(Array.isArray(watchProviders.flatrate)
        ? watchProviders.flatrate
        : []),
      ...(Array.isArray(watchProviders.buy) ? watchProviders.buy : []),
      ...(Array.isArray(watchProviders.rent) ? watchProviders.rent : []),
    ].filter((provider) => {
      const id = String(provider?.provider_id || provider?.provider_name || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [watchProviders]);

  const featuredWatchProvider = allWatchProviders[0] || null;

  useEffect(() => {
    let isCancelled = false;

    async function loadCoreShow() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user || null;

      if (!user) {
        if (!isCancelled) {
          setCurrentUserId(null);
          setWatchedLoaded(true);
          const state = emptyState();
          setShow(state.show);
          setEpisodes(state.episodes);
          setWatchedRows(state.watchedRows);
          setCommunityWatchedRows(state.communityWatchedRows);
          setExpandedSeasons(state.expandedSeasons);
          setCast(state.cast);
          setCrew(state.crew);
          setRecommendedShows(state.recommendedShows);
          setPeopleAlsoWatch(state.peopleAlsoWatch);
          setSavedShowTvdbIds(state.savedShowTvdbIds);
          setBurgrRatings(state.burgrRatings);
          setMyBurgrRating(state.myBurgrRating);
          setEpisodeRatings(state.episodeRatings);
          setSavingEpisodeRatingId(state.savingEpisodeRatingId);
          setHoverEpisodeRatings(state.hoverEpisodeRatings);
          setOpenEpisodeRatingPickerId(state.openEpisodeRatingPickerId);
          setOpenEpisodeReviewId(state.openEpisodeReviewId);
          setMobileBannerUrl(state.mobileBannerUrl);
          setRankPosition(state.rankPosition);
          setWatchProviders(state.watchProviders);
          setWatchOptionsOpen(false);
        }
        return {
          found: true,
          user: null,
          showId: null,
          tvdbId: null,
          tmdbId: null,
          storedBackdropUrl: null,
        };
      }

      if (!isCancelled) {
        setCurrentUserId(user.id);
      }

      const numericRouteId = Number(routeId);

      if (Number.isNaN(numericRouteId)) {
        if (!isCancelled) {
          setShow(null);
          setEpisodes([]);
          setWatchedRows([]);
          setCommunityWatchedRows([]);
          setExpandedSeasons({});
          setMobileBannerUrl(null);
          setRankPosition(null);
          setWatchProviders(null);
          setWatchOptionsOpen(false);
          setWatchedLoaded(true);
        }
        return {
          found: false,
          user,
          showId: null,
          tvdbId: null,
          tmdbId: null,
          storedBackdropUrl: null,
        };
      }

      const core = await fetchShowCoreCached({
        source: isTmdbRoute ? "tmdb" : "tvdb",
        id: numericRouteId,
      });
      const showData = core.show || null;

      if (!showData) {
        if (!isCancelled) {
          setShow(null);
          setEpisodes([]);
          setWatchedRows([]);
          setCommunityWatchedRows([]);
          setExpandedSeasons({});
          setMobileBannerUrl(null);
          setRankPosition(null);
          setWatchProviders(null);
          setWatchOptionsOpen(false);
          setWatchedLoaded(true);
        }
        return {
          found: false,
          user,
          showId: null,
          tvdbId: isTmdbRoute ? null : numericRouteId,
          tmdbId: isTmdbRoute ? numericRouteId : null,
          storedBackdropUrl: null,
        };
      }

      const showId = showData.id;

      const { data: userShowData, error: userShowError } = await supabase
        .from("user_shows_new")
        .select(`
          id,
          user_id,
          show_id,
          watch_status,
          archived_at,
          added_at,
          created_at
        `)
        .eq("user_id", user.id)
        .eq("show_id", showId)
        .maybeSingle();

      if (userShowError) throw userShowError;

      const episodeRows = core.episodes || [];

      const normalizedEpisodes = episodeRows.map((row) => ({
        id: row.id,
        tvdb_episode_id: row.tvdb_id,
        seasonNumber: row.season_number,
        number: row.episode_number,
        aired: row.aired_date,
        airDate: row.aired_date,
        name: row.name || "Untitled episode",
        overview: "",
        image: null,
        episode_code: row.episode_code,
        tmdbRating: null,
        tmdbVoteCount: 0,
      }));

      const seasonMap = {};
      normalizedEpisodes.forEach((ep) => {
        const seasonKey = Number(ep.seasonNumber ?? 0);
        if (seasonKey === 0) return;
        if (!(seasonKey in seasonMap)) seasonMap[seasonKey] = false;
      });

      let targetEpisodeSeason = null;

      if (targetEpisodeId) {
        const targetEpisode = normalizedEpisodes.find(
          (ep) => String(ep.id) === String(targetEpisodeId)
        );
        if (targetEpisode) {
          targetEpisodeSeason = Number(targetEpisode.seasonNumber ?? 0);
          seasonMap[targetEpisodeSeason] = true;
        }
      }

      if (!isCancelled) {
        setShow({
          id: showData.id,
          tvdb_id: showData.tvdb_id,
          tmdb_id: showData.tmdb_id,
          show_name: showData.name || "Unknown title",
          overview: showData.overview || "",
          poster_url: showData.poster_url || null,
          backdrop_url: showData.backdrop_url || null,
          first_aired: showData.first_aired || null,
          status: showData.status || null,
          network: showData.network || "",
          original_language: showData.original_language || "",
          genres: Array.isArray(showData.genres) ? showData.genres : [],
          relationship_types: Array.isArray(showData.relationship_types)
            ? showData.relationship_types
            : [],
          settings: Array.isArray(showData.settings) ? showData.settings : [],
          rating_average:
            showData.rating_average != null
              ? Number(showData.rating_average)
              : null,
          rating_count:
            showData.rating_count != null
              ? Number(showData.rating_count)
              : null,
          watch_status: userShowData?.watch_status || "watchlist",
          archived_at: userShowData?.archived_at || null,
          added_at: userShowData?.added_at || null,
          created_at: userShowData?.created_at || null,
        });

        setEpisodes(normalizedEpisodes);
        setExpandedSeasons(seasonMap);
        setMobileBannerUrl(showData.backdrop_url || null);
        setExpandedOverview(false);
        setActiveTab("seasons");
        setWatchProviders(null);
        setWatchOptionsOpen(false);
      }

      if (targetEpisodeSeason != null) {
        void fetchSeasonEpisodeDetailsCached(showId, targetEpisodeSeason)
          .then((rows) => {
            if (isCancelled) return;

            const detailsById = new Map(rows.map((row) => [String(row.id), row]));
            setEpisodes((current) =>
              current.map((episode) => {
                const row = detailsById.get(String(episode.id));
                if (!row) return episode;

                return {
                  ...episode,
                  overview: row.overview || "",
                  image: row.image_url || row.tmdb_still_path || null,
                  tmdbRating:
                    row.tmdb_vote_average != null &&
                    !Number.isNaN(Number(row.tmdb_vote_average))
                      ? Number(row.tmdb_vote_average)
                      : null,
                  tmdbVoteCount:
                    row.tmdb_vote_count != null &&
                    !Number.isNaN(Number(row.tmdb_vote_count))
                      ? Number(row.tmdb_vote_count)
                      : 0,
                };
              })
            );
          })
          .catch((error) => {
            console.warn("Target episode season details unavailable", error);
          });
      }

      return {
        found: true,
        user,
        showId,
        tvdbId: showData.tvdb_id || null,
        tmdbId: showData.tmdb_id || null,
        storedBackdropUrl: showData.backdrop_url || null,
        episodeIds: normalizedEpisodes.map((ep) => ep.id),
      };
    }

    async function loadSecondaryData(
      user,
      showId,
      episodeIds,
      tvdbId,
      tmdbIdValue,
      storedBackdropUrl
    ) {
      try {
        const [
          savedShowsResult,
          burgrRows,
          showWatchedRows,
          rankingRowResult,
        ] = await Promise.all([
          supabase
            .from("user_shows_new")
            .select(`shows!inner(tvdb_id)`)
            .eq("user_id", user.id),
          fetchBurgrRatings(showId),
          fetchWatchedRowsForEpisodeIds(episodeIds, user.id),
          supabase
            .from("user_show_rankings")
            .select("ladder_position")
            .eq("user_id", user.id)
            .eq("show_id", showId)
            .maybeSingle(),
        ]);

        if (isCancelled) return;

        const savedShowsData = savedShowsResult?.data || [];

        if (rankingRowResult?.error) throw rankingRowResult.error;

        const ladderPosition = Number(rankingRowResult?.data?.ladder_position);
        setRankPosition(
          Number.isFinite(ladderPosition) && ladderPosition > 0
            ? ladderPosition
            : null
        );

        const savedTvdbIds = new Set(
          savedShowsData
            .map((row) => row?.shows?.tvdb_id)
            .filter(Boolean)
            .map(String)
        );

        const myWatchedRows = showWatchedRows || [];
        const mine = (burgrRows || []).find((row) => row.user_id === user.id);

        setSavedShowTvdbIds(savedTvdbIds);
        setWatchedRows(myWatchedRows);
        setCommunityWatchedRows(showWatchedRows || []);
        setWatchedLoaded(true);
        setBurgrRatings(burgrRows || []);
        setMyBurgrRating(mine ? String(mine.rating) : "");
        setEpisodeRatings([]);
        loadedEpisodeRatingSeasonsRef.current.clear();
        setSavingEpisodeRatingId(null);
        setHoverEpisodeRatings({});
        setOpenEpisodeRatingPickerId(null);

        try {
          setExtrasLoading(true);

          const extras = await fetchShowExtrasCached({
            source: tvdbId != null ? "tvdb" : "tmdb",
            id: tvdbId != null ? tvdbId : tmdbIdValue,
          });

          let providers = null;

          if (tmdbIdValue) {
            try {
              const providersRes = await fetch(
                `/.netlify/functions/getTmdbWatchProviders?tmdbId=${tmdbIdValue}&country=GB`
              );

              if (providersRes.ok) {
                providers = await providersRes.json();
              }
            } catch (providerError) {
              console.error("Failed loading watch providers:", providerError);
            }
          }

          const castRows = Array.isArray(extras.cast) ? extras.cast : [];
          const crewRows = Array.isArray(extras.crew) ? extras.crew : [];
          const fallbackRecommendations = Array.isArray(extras.recommendations)
            ? extras.recommendations
            : [];
          const bannerFromExtras =
            getBannerFromExtras(extras) ||
            extras.backdrop_url ||
            storedBackdropUrl ||
            null;

          let mappedTmdbRecommendations = [];
          try {
            mappedTmdbRecommendations =
              await enrichTmdbShowsWithMappings(fallbackRecommendations);
          } catch (mappingError) {
            console.error("Failed mapping TMDB recommendations:", mappingError);

            mappedTmdbRecommendations = fallbackRecommendations.map((item) =>
              normalizeMappedShow({
                ...item,
                source: "tmdb",
                name:
                  item?.name ||
                  item?.title ||
                  item?.show_name ||
                  "Unknown show",
                first_air_date:
                  item?.first_air_date ||
                  item?.firstAired ||
                  item?.first_aired ||
                  "",
                poster_url:
                  item?.poster_url ||
                  item?.posterUrl ||
                  item?.image_url ||
                  item?.image ||
                  (item?.poster_path
                    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                    : ""),
                poster_path: item?.poster_path || null,
              })
            );
          }

          const filteredTmdbRecommendations = mappedTmdbRecommendations;

          if (!isCancelled) {
            setCast(castRows);
            setCrew(crewRows);
            setPeopleAlsoWatch([]);
            setRecommendedShows(filteredTmdbRecommendations);
            setMobileBannerUrl(storedBackdropUrl || bannerFromExtras || null);
            setWatchProviders(providers);
          }
        } catch (extrasError) {
          console.error("Failed loading TVDB extras:", extrasError);
          if (!isCancelled) {
            setCast([]);
            setCrew([]);
            setRecommendedShows([]);
            setPeopleAlsoWatch([]);
            setMobileBannerUrl(storedBackdropUrl || null);
            setWatchProviders(null);
            setWatchOptionsOpen(false);
          }
        } finally {
          if (!isCancelled) {
            setExtrasLoading(false);
          }
        }
      } catch (secondaryError) {
        console.error("Failed loading secondary show data:", secondaryError);
        if (!isCancelled) {
          setBurgrRatings([]);
          setMyBurgrRating("");
          setEpisodeRatings([]);
          setCast([]);
          setCrew([]);
          setRecommendedShows([]);
          setPeopleAlsoWatch([]);
          setSavedShowTvdbIds(new Set());
          setExtrasLoading(false);
          setMobileBannerUrl(storedBackdropUrl || null);
          setRankPosition(null);
          setWatchProviders(null);
          setWatchOptionsOpen(false);
          setWatchedLoaded(true);
        }
      }
    }

    async function loadShowWithRetry() {
      setLoading(true);
      setExtrasLoading(false);
      setWatchedLoaded(false);
      setWatchedRows([]);
      setCommunityWatchedRows([]);

      try {
        const maxAttempts = 6;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const result = await loadCoreShow();

          if (result?.found) {
            if (!isCancelled) {
              setLoading(false);
            }

            if (
              result.user &&
              result.showId &&
              Array.isArray(result.episodeIds)
            ) {
              loadSecondaryData(
                result.user,
                result.showId,
                result.episodeIds,
                result.tvdbId,
                result.tmdbId,
                result.storedBackdropUrl
              );
            } else if (!isCancelled) {
              setWatchedLoaded(true);
            }
            return;
          }

          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        if (!isCancelled) {
          setShow(null);
          setEpisodes([]);
          setWatchedRows([]);
          setCommunityWatchedRows([]);
          setExpandedSeasons({});
          setCast([]);
          setCrew([]);
          setRecommendedShows([]);
          setPeopleAlsoWatch([]);
          setSavedShowTvdbIds(new Set());
          setBurgrRatings([]);
          setMyBurgrRating("");
          setEpisodeRatings([]);
          setSavingEpisodeRatingId(null);
          setHoverEpisodeRatings({});
          setOpenEpisodeRatingPickerId(null);
          setOpenEpisodeReviewId(null);
          setMobileBannerUrl(null);
          setRankPosition(null);
          setWatchProviders(null);
          setWatchOptionsOpen(false);
          setWatchedLoaded(true);
        }
      } catch (error) {
        console.error("Failed loading show:", error);
        if (!isCancelled) {
          setShow(null);
          setEpisodes([]);
          setWatchedRows([]);
          setCommunityWatchedRows([]);
          setExpandedSeasons({});
          setCast([]);
          setCrew([]);
          setRecommendedShows([]);
          setPeopleAlsoWatch([]);
          setSavedShowTvdbIds(new Set());
          setBurgrRatings([]);
          setMyBurgrRating("");
          setEpisodeRatings([]);
          setSavingEpisodeRatingId(null);
          setHoverEpisodeRatings({});
          setOpenEpisodeRatingPickerId(null);
          setOpenEpisodeReviewId(null);
          setMobileBannerUrl(null);
          setRankPosition(null);
          setWatchProviders(null);
          setWatchOptionsOpen(false);
          setWatchedLoaded(true);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadShowWithRetry();

    return () => {
      isCancelled = true;
    };
  }, [routeId, targetEpisodeId, isTmdbRoute]);

  useEffect(() => {
    if (!show || !watchedLoaded) return undefined;

    const frame = window.requestAnimationFrame(() => {
      document.dispatchEvent(
        new CustomEvent("burgrs:show-page-ready", {
          detail: {
            saved: true,
            showId: show.id,
            watchedLoaded,
            extrasLoading,
            watchedIds: (watchedRows || [])
              .map((row) => row?.episode_id)
              .filter(Boolean),
          },
        })
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    show,
    episodes,
    watchedRows,
    watchedLoaded,
    extrasLoading,
    rankPosition,
  ]);

  useEffect(() => {
    if (targetEpisodeId) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [routeId, targetEpisodeId]);

  useEffect(() => {
    if (!targetEpisodeId || loading) return;

    const timer = setTimeout(() => {
      const el = document.getElementById(`episode-${targetEpisodeId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("episode-highlight");
      setTimeout(() => el.classList.remove("episode-highlight"), 2500);
    }, 300);

    return () => clearTimeout(timer);
  }, [episodes, expandedSeasons, targetEpisodeId, loading]);

  useEffect(() => {
  if (!overviewRef.current) return;

  const el = overviewRef.current;

  setHasOverflow(el.scrollHeight > el.clientHeight);
}, [show?.overview, expandedOverview]);

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
      .map(([seasonNumber, seasonEpisodes]) => {
        const watchedCount = seasonEpisodes.filter((ep) =>
          isEpisodeWatched(ep, watchedLookup)
        ).length;

        return {
          seasonNumber: Number(seasonNumber),
          label: `Season ${seasonNumber}`,
          episodes: seasonEpisodes,
          watchedCount,
          totalCount: seasonEpisodes.length,
          complete:
            seasonEpisodes.length > 0 &&
            watchedCount === seasonEpisodes.length,
        };
      });
  }, [episodes, watchedLookup]);

  const stats = useMemo(() => {
    const mainEpisodes = episodes.filter(
      (ep) => Number(ep.seasonNumber ?? 0) !== 0
    );

    const total = mainEpisodes.length;
    const watched = mainEpisodes.filter((ep) =>
      isEpisodeWatched(ep, watchedLookup)
    ).length;
    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;
    const nextEpisode = mainEpisodes.find(
      (ep) => !isEpisodeWatched(ep, watchedLookup) && isFuture(ep.aired)
    );

    return { total, watched, pct, nextEpisode };
  }, [episodes, watchedLookup]);

  const nextUnwatchedEpisode = useMemo(() => {
    const mainEpisodes = [...episodes]
      .filter((ep) => Number(ep.seasonNumber ?? 0) > 0)
      .sort((a, b) => {
        const seasonDiff =
          Number(a.seasonNumber ?? 0) - Number(b.seasonNumber ?? 0);
        if (seasonDiff !== 0) return seasonDiff;
        return Number(a.number ?? 0) - Number(b.number ?? 0);
      });

    if (!mainEpisodes.length) return null;

    let lastWatchedIndex = -1;

    mainEpisodes.forEach((ep, index) => {
      if (isEpisodeWatched(ep, watchedLookup)) {
        lastWatchedIndex = index;
      }
    });

    if (lastWatchedIndex < 0) {
      return (
        mainEpisodes.find((ep) => !isEpisodeWatched(ep, watchedLookup)) || null
      );
    }

    return (
      mainEpisodes
        .slice(lastWatchedIndex + 1)
        .find((ep) => !isEpisodeWatched(ep, watchedLookup)) || null
    );
  }, [episodes, watchedLookup]);

  useEffect(() => {
    async function syncWatchStatus() {
      if (!currentUserId || !show?.id) return;
      if (!watchedLoaded) return;
      if (!episodes.length) return;
      if (show.watch_status === "not_added") return;
      if (show.watch_status === "archived") return;
      if (savingShowAction) return;

      let desiredStatus = show.watch_status || "watchlist";

      if (stats.total > 0 && stats.watched >= stats.total) {
        desiredStatus = "completed";
      } else if (stats.watched > 0) {
        desiredStatus = "watching";
      } else if (show.watch_status === "completed") {
        return;
      } else {
        desiredStatus = "watchlist";
      }

      if (show.watch_status === desiredStatus) return;

      try {
        const { error } = await supabase
          .from("user_shows_new")
          .update({
            watch_status: desiredStatus,
            archived_at: null,
          })
          .eq("user_id", currentUserId)
          .eq("show_id", show.id);

        if (error) throw error;

        setShow((prev) =>
          prev
            ? {
                ...prev,
                watch_status: desiredStatus,
                archived_at: null,
              }
            : prev
        );
      } catch (error) {
        console.error("Failed syncing watch status:", error);
      }
    }

    syncWatchStatus();
  }, [
    currentUserId,
    show?.id,
    show?.watch_status,
    stats.total,
    stats.watched,
    episodes.length,
    watchedLoaded,
    savingShowAction,
  ]);

  const sourceYear = getYear(show?.first_aired);
  const sourceRating =
    show?.rating_average != null && !Number.isNaN(Number(show.rating_average))
      ? Number(show.rating_average).toFixed(1)
      : "";
  const sourceLanguage = show?.original_language || "";
  const isRemoved = show?.watch_status === "not_added";
  const isArchived = show?.watch_status === "archived";

  async function hydrateSeasonEpisodeDetails(seasonNumber) {
    if (!show?.id) return;

    const seasonEpisodeIds = episodes
      .filter((episode) => Number(episode.seasonNumber) === Number(seasonNumber))
      .map((episode) => episode.id)
      .filter(Boolean);
    const ratingsKey = `${show.id}:${seasonNumber}`;
    const shouldLoadRatings =
      !loadedEpisodeRatingSeasonsRef.current.has(ratingsKey);

    try {
      const [rows, seasonRatings] = await Promise.all([
        fetchSeasonEpisodeDetailsCached(show.id, seasonNumber),
        shouldLoadRatings
          ? fetchAllEpisodeRatingsForShowEpisodeIds(seasonEpisodeIds)
          : Promise.resolve(null),
      ]);
      const detailsById = new Map(rows.map((row) => [String(row.id), row]));

      setEpisodes((current) =>
        current.map((episode) => {
          const row = detailsById.get(String(episode.id));
          if (!row) return episode;

          return {
            ...episode,
            overview: row.overview || "",
            image: row.image_url || row.tmdb_still_path || null,
            episode_code: row.episode_code || episode.episode_code,
            tmdbRating:
              row.tmdb_vote_average != null &&
              !Number.isNaN(Number(row.tmdb_vote_average))
                ? Number(row.tmdb_vote_average)
                : null,
            tmdbVoteCount:
              row.tmdb_vote_count != null &&
              !Number.isNaN(Number(row.tmdb_vote_count))
                ? Number(row.tmdb_vote_count)
                : 0,
          };
        })
      );

      if (seasonRatings) {
        const seasonIdSet = new Set(seasonEpisodeIds.map(String));
        setEpisodeRatings((current) => [
          ...(current || []).filter(
            (row) => !seasonIdSet.has(String(row.episode_id))
          ),
          ...seasonRatings,
        ]);
        loadedEpisodeRatingSeasonsRef.current.add(ratingsKey);
      }
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

  useEffect(() => {
    if (!targetEpisodeId || !show?.id || !episodes.length) return;

    const targetEpisode = episodes.find(
      (episode) => String(episode.id) === String(targetEpisodeId)
    );

    if (targetEpisode) {
      void hydrateSeasonEpisodeDetails(targetEpisode.seasonNumber);
    }
  }, [targetEpisodeId, show?.id, episodes.length]);

  async function refreshBurgrRatings(showId, userId) {
    const fresh = await fetchBurgrRatings(showId);
    setBurgrRatings(fresh);
    const mine = (fresh || []).find((row) => row.user_id === userId);
    setMyBurgrRating(mine ? String(mine.rating) : "");
  }

  async function refreshEpisodeRatings(showEpisodeIds) {
    const fresh = await fetchAllEpisodeRatingsForShowEpisodeIds(showEpisodeIds);
    const idSet = new Set((showEpisodeIds || []).map(String));

    setEpisodeRatings((current) => [
      ...(current || []).filter(
        (row) => !idSet.has(String(row.episode_id))
      ),
      ...fresh,
    ]);
  }

  async function handleToggleRemoveShow() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !show?.id || savingShowAction) return;

    setSavingShowAction(true);

    try {
      if (isRemoved) {
        let restoredStatus = "watchlist";

        if (stats.total > 0 && stats.watched >= stats.total) {
          restoredStatus = "completed";
        } else if (stats.watched > 0) {
          restoredStatus = "watching";
        }

        const { error } = await supabase.from("user_shows_new").upsert(
          {
            user_id: user.id,
            show_id: show.id,
            watch_status: restoredStatus,
            archived_at: null,
          },
          { onConflict: "user_id,show_id" }
        );

        if (error) throw error;

        setShow((prev) =>
          prev
            ? {
                ...prev,
                watch_status: restoredStatus,
                archived_at: null,
              }
            : prev
        );
      } else {
        const { error } = await supabase
          .from("user_shows_new")
          .delete()
          .eq("user_id", user.id)
          .eq("show_id", show.id);

        if (error) throw error;

        setShow((prev) =>
          prev
            ? {
                ...prev,
                watch_status: "not_added",
                archived_at: null,
              }
            : prev
        );
        setRankPosition(null);
      }
    } catch (error) {
      console.error("Failed toggling remove show:", error);
      alert(error.message || "Failed updating show");
    } finally {
      setSavingShowAction(false);
    }
  }

  async function handleToggleArchiveShow() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !show?.id || savingShowAction || isRemoved) return;

    setSavingShowAction(true);

    try {
      if (isArchived) {
        let restoredStatus = "watchlist";

        if (stats.total > 0 && stats.watched >= stats.total) {
          restoredStatus = "completed";
        } else if (stats.watched > 0) {
          restoredStatus = "watching";
        }

        const { error } = await supabase
          .from("user_shows_new")
          .update({
            watch_status: restoredStatus,
            archived_at: null,
          })
          .eq("user_id", user.id)
          .eq("show_id", show.id);

        if (error) throw error;

        setShow((prev) =>
          prev
            ? {
                ...prev,
                watch_status: restoredStatus,
                archived_at: null,
              }
            : prev
        );
      } else {
        const archivedAt = new Date().toISOString();

        const { error } = await supabase
          .from("user_shows_new")
          .update({
            watch_status: "archived",
            archived_at: archivedAt,
          })
          .eq("user_id", user.id)
          .eq("show_id", show.id);

        if (error) throw error;

        setShow((prev) =>
          prev
            ? {
                ...prev,
                watch_status: "archived",
                archived_at: archivedAt,
              }
            : prev
        );
      }
    } catch (error) {
      console.error("Failed toggling archive show:", error);
      alert(error.message || "Failed updating archive status");
    } finally {
      setSavingShowAction(false);
    }
  }

  async function handleMarkWatched(ep) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || ep?.id == null) return;

    const watched = isEpisodeWatched(ep, watchedLookup);
    const previousRows = watchedRows;
    const previousCommunityRows = communityWatchedRows;
    const optimisticRow = {
      user_id: user.id,
      episode_id: ep.id,
    };

    if (watched) {
      setWatchedRows((prev) =>
        (prev || []).filter(
          (row) => String(row?.episode_id ?? "") !== String(ep.id)
        )
      );
      setCommunityWatchedRows((prev) =>
        (prev || []).filter(
          (row) =>
            !(
              String(row?.episode_id ?? "") === String(ep.id) &&
              String(row?.user_id ?? "") === String(user.id)
            )
        )
      );
    } else {
      setWatchedRows((prev) => {
        const next = [...(prev || [])];
        if (
          !next.some((row) => String(row?.episode_id ?? "") === String(ep.id))
        ) {
          next.push(optimisticRow);
        }
        return next;
      });
      setCommunityWatchedRows((prev) => {
        const next = [...(prev || [])];
        if (
          !next.some(
            (row) =>
              String(row?.episode_id ?? "") === String(ep.id) &&
              String(row?.user_id ?? "") === String(user.id)
          )
        ) {
          next.push(optimisticRow);
        }
        return next;
      });
    }

    try {
      if (watched) {
        const { error } = await supabase
          .from("watched_episodes")
          .delete()
          .eq("user_id", user.id)
          .eq("episode_id", ep.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("watched_episodes")
          .upsert(
            {
              user_id: user.id,
              episode_id: ep.id,
            },
            { onConflict: "user_id,episode_id" }
          );

        if (error) throw error;
      }
    } catch (error) {
      console.error("Failed toggling watched state:", error);
      setWatchedRows(previousRows);
      setCommunityWatchedRows(previousCommunityRows);
      alert(error.message || "Failed updating watched status");
    }
  }

  async function handleMarkNextEpisodeWatched() {
    if (!nextUnwatchedEpisode) return;
    await handleMarkWatched(nextUnwatchedEpisode);
  }

  async function handleWatchUpToHere(targetEpisode) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !targetEpisode?.id) return;

    const previousRows = watchedRows;
    const previousCommunityRows = communityWatchedRows;

    try {
      const mainEpisodes = [...episodes]
        .filter((ep) => Number(ep.seasonNumber ?? 0) > 0)
        .sort((a, b) => {
          const seasonDiff =
            Number(a.seasonNumber ?? 0) - Number(b.seasonNumber ?? 0);
          if (seasonDiff !== 0) return seasonDiff;

          return Number(a.number ?? 0) - Number(b.number ?? 0);
        });

      const targetIndex = mainEpisodes.findIndex(
        (ep) => String(ep.id) === String(targetEpisode.id)
      );

      if (targetIndex === -1) return;

      const episodesToWatch = mainEpisodes.slice(0, targetIndex + 1);
      const episodesToUnwatch = mainEpisodes.slice(targetIndex + 1);

      const rowsToUpsert = episodesToWatch.map((ep) => ({
        user_id: user.id,
        episode_id: ep.id,
      }));

      const idsToDelete = episodesToUnwatch.map((ep) => ep.id);

      setWatchedRows((prev) => {
        const keptNonShowRows = (prev || []).filter(
          (row) =>
            !mainEpisodes.some(
              (ep) => String(ep.id) === String(row?.episode_id ?? "")
            )
        );

        return [...keptNonShowRows, ...rowsToUpsert];
      });

      setCommunityWatchedRows((prev) => {
        const keptRows = (prev || []).filter((row) => {
          const isThisUser = String(row?.user_id ?? "") === String(user.id);
          const isShowEpisode = mainEpisodes.some(
            (ep) => String(ep.id) === String(row?.episode_id ?? "")
          );

          return !(isThisUser && isShowEpisode);
        });

        const mine = rowsToUpsert.map((row) => ({
          user_id: row.user_id,
          episode_id: row.episode_id,
        }));

        return [...keptRows, ...mine];
      });

      if (rowsToUpsert.length) {
        const { error: upsertError } = await supabase
          .from("watched_episodes")
          .upsert(rowsToUpsert, { onConflict: "user_id,episode_id" });

        if (upsertError) throw upsertError;
      }

      if (idsToDelete.length) {
        const { error: deleteError } = await supabase
          .from("watched_episodes")
          .delete()
          .eq("user_id", user.id)
          .in("episode_id", idsToDelete);

        if (deleteError) throw deleteError;
      }
    } catch (error) {
      console.error("Failed watch up to here:", error);
      setWatchedRows(previousRows);
      setCommunityWatchedRows(previousCommunityRows);
      alert("Failed to save watched episodes");
    }
  }

  async function handleSelectBurgrRating(value) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !show?.id || savingBurgr) return;

    const rating = Number(value);
    if (Number.isNaN(rating) || rating < 0 || rating > 100) return;

    const previousRating = myBurgrRating;
    setMyBurgrRating(String(rating));
    setDraftBurgrRating("");
    setSavingBurgr(true);

    try {
      const { error } = await supabase.from("burgr_ratings").upsert(
        { user_id: user.id, show_id: show.id, rating },
        { onConflict: "user_id,show_id" }
      );
      if (error) throw error;
      await refreshBurgrRatings(show.id, user.id);
    } catch (error) {
      console.error("Failed saving Burgr rating:", error);
      setMyBurgrRating(previousRating);
      setDraftBurgrRating("");
      alert(error.message || "Failed saving Burgr rating");
    } finally {
      setSavingBurgr(false);
      setDraftBurgrRating("");
    }
  }

  async function handleSelectEpisodeRating(ep, value) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !ep?.id || savingEpisodeRatingId) return;

    const rating = Number(value);
    if (Number.isNaN(rating) || rating < 0 || rating > 100) return;

    setSavingEpisodeRatingId(ep.id);

    const previousRows = episodeRatings;

    const optimisticRows = [
      ...(episodeRatings || []).filter(
        (row) =>
          !(
            String(row.episode_id) === String(ep.id) && row.user_id === user.id
          )
      ),
      {
        user_id: user.id,
        episode_id: ep.id,
        rating,
      },
    ];

    setEpisodeRatings(optimisticRows);

    try {
      const { error } = await supabase.from("episode_ratings").upsert(
        {
          user_id: user.id,
          episode_id: ep.id,
          rating,
        },
        { onConflict: "user_id,episode_id" }
      );

      if (error) throw error;

      const seasonEpisodeIds = episodes
        .filter(
          (episode) =>
            Number(episode.seasonNumber) === Number(ep.seasonNumber)
        )
        .map((episode) => episode.id);
      await refreshEpisodeRatings(seasonEpisodeIds);
      setHoverEpisodeRatings((prev) => {
        const next = { ...prev };
        delete next[String(ep.id)];
        return next;
      });
      setOpenEpisodeRatingPickerId(null);
    } catch (error) {
      console.error("Failed saving episode rating:", error);
      setEpisodeRatings(previousRows);
      setHoverEpisodeRatings((prev) => {
        const next = { ...prev };
        delete next[String(ep.id)];
        return next;
      });
      alert(error.message || "Failed saving episode rating");
    } finally {
      setSavingEpisodeRatingId(null);
    }
  }

  function handleOpenEpisodeRatingPicker(epId) {
    setOpenEpisodeRatingPickerId((prev) => (prev === epId ? null : epId));
  }


  function openContentTab(tabName) {
    setActiveTab(tabName);
    setChatBoardOpen(false);
    window.setTimeout(() => {
      contentTabsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  function openChatBoard() {
    setChatBoardOpen(true);
  }

  function closeChatBoard() {
    setChatBoardOpen(false);
  }

  useEffect(() => {
    if (!chatBoardOpen) return undefined;

    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [chatBoardOpen]);

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
            <p>Show not found.</p>
          </div>
        </div>
      </div>
    );
  }

  const activeBurgrRating = Number(draftBurgrRating !== "" ? draftBurgrRating : myBurgrRating || 0);
  const baseContext = `sourceShowId=${encodeURIComponent(
    show.tvdb_id || show.tmdb_id || ""
  )}&sourceYear=${encodeURIComponent(
    sourceYear
  )}&sourceRating=${encodeURIComponent(
    sourceRating
  )}&sourceLanguage=${encodeURIComponent(sourceLanguage)}`;

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
                    <div className="msd-mobile-meta-row">
  <span className="msd-mobile-year">
    {new Date(show.first_aired).getFullYear()}
  </span>

  {show.original_language ? (
  <span className="msd-mobile-language">
    (
    {
      new Intl.DisplayNames(["en"], {
        type: "language",
      }).of(show.original_language)
    }
    )
  </span>
) : null}
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
  ref={overviewRef}
  className={`msd-overview msd-overview-mobile ${
    expandedOverview ? "expanded" : "collapsed"
  }`}
>
                  {show.overview}
                </p>

               {hasOverflow || expandedOverview ? (
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
) : null}
              </div>
            ) : null}

            <div className="msd-stats-row msd-stats-row-top msd-stats-row-five">
              <div className="msd-stat-box">
                <span className="msd-stat-label">Watched</span>
                <strong className="msd-stat-value">
                  {watchedLoaded ? stats.watched : "..."}
                </strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Total</span>
                <strong className="msd-stat-value">{stats.total}</strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Progress</span>
                <strong className="msd-stat-value">
                  {watchedLoaded ? `${stats.pct}%` : "..."}
                </strong>
              </div>

              <div className="msd-stat-box">
                <span className="msd-stat-label">Rank'd</span>
                <strong className="msd-stat-value">
                  {rankPosition ? `#${rankPosition}` : "—"}
                </strong>
              </div>

              <button
                type="button"
                className={`msd-stat-box msd-watch-stat-box ${
                  watchOptionsOpen ? "is-open" : ""
                }`}
                onClick={() => setWatchOptionsOpen((prev) => !prev)}
              >
                <span className="msd-stat-label">Watch</span>

                {featuredWatchProvider?.logo_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${featuredWatchProvider.logo_path}`}
                    alt={featuredWatchProvider.provider_name}
                    className="msd-watch-stat-logo"
                  />
                ) : (
                  <strong className="msd-stat-value">—</strong>
                )}
              </button>
            </div>

            {watchOptionsOpen ? (
              <div className="msd-watch-dropdown">
                {!watchProviders || allWatchProviders.length === 0 ? (
                  <p className="msd-muted">
                    No streaming information available yet.
                  </p>
                ) : (
                  <div className="msd-watch-panel">
                    {[
                      ["Stream", watchProviders.flatrate],
                      ["Buy", watchProviders.buy],
                      ["Rent", watchProviders.rent],
                    ].map(([label, providers]) =>
                      Array.isArray(providers) && providers.length > 0 ? (
                        <div key={label} className="msd-watch-section">
                          <h3 className="msd-watch-title">{label}</h3>

                          <div className="msd-watch-grid">
                            {providers.map((provider) => (
                              <div
                                key={provider.provider_id}
                                className="msd-watch-card"
                                title={provider.provider_name}
                              >
                                {provider.logo_path ? (
                                  <img
                                    src={`https://image.tmdb.org/t/p/w185${provider.logo_path}`}
                                    alt={provider.provider_name}
                                    className="msd-watch-logo"
                                  />
                                ) : null}

                                <span>{provider.provider_name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div className="msd-stat-box msd-stat-box-full">
              <span className="msd-stat-label">Your Burgr Rating</span>
              <div className="msd-burgr-form msd-burgr-form-compact">
                <div className="msd-rating-slider-wrap">
                  <input
  type="range"
  min="0"
  max="100"
  step="1"
  value={activeBurgrRating}
  onTouchStart={(event) => {
    const touch = event.touches?.[0];
    if (!touch) return;

    burgrTouchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      horizontalDrag: false,
    };
  }}
  onTouchMove={(event) => {
    const touch = event.touches?.[0];
    if (!touch) return;

    const dx = Math.abs(touch.clientX - burgrTouchRef.current.startX);
    const dy = Math.abs(touch.clientY - burgrTouchRef.current.startY);

    burgrTouchRef.current.horizontalDrag = dx > 12 && dx > dy * 1.4;
  }}
  onChange={(event) => {
    if (
      event.nativeEvent?.type === "input" &&
      "ontouchstart" in window &&
      !burgrTouchRef.current.horizontalDrag
    ) {
      return;
    }

    setDraftBurgrRating(event.target.value);
  }}
  onMouseUp={(event) =>
    handleSelectBurgrRating(event.currentTarget.value)
  }
  onTouchEnd={(event) => {
    if (!burgrTouchRef.current.horizontalDrag) {
      setDraftBurgrRating("");
      return;
    }

    handleSelectBurgrRating(event.currentTarget.value);
  }}
  onBlur={(event) => {
    if ("ontouchstart" in window && !burgrTouchRef.current.horizontalDrag) {
      return;
    }

    handleSelectBurgrRating(event.currentTarget.value);
  }}
  disabled={savingBurgr}
  className="msd-rating-slider"
  aria-label="Rate this show from 0 to 100 percent"
/>
                  <div className="msd-rating-slider-row">
                    <span>0%</span>
                    <strong>{savingBurgr ? "Saving..." : `${activeBurgrRating}%`}</strong>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {extrasLoading ? (
          <div className="msd-inline-loading" role="status">
            Loading cast, ratings and recommendations...
          </div>
        ) : null}

        <section className="msd-content-tabs-section" ref={contentTabsSectionRef}>
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
              onClick={() => openContentTab("seasons")}
            >
              Seasons
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "cast" ? "is-active" : ""
              }`}
              onClick={() => openContentTab("cast")}
            >
              Cast
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "crew" ? "is-active" : ""
              }`}
              onClick={() => openContentTab("crew")}
            >
              Crew
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "studio" ? "is-active" : ""
              }`}
              onClick={() => openContentTab("studio")}
            >
              Studio
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "genre" ? "is-active" : ""
              }`}
              onClick={() => openContentTab("genre")}
            >
              Genre
            </button>

            <button
              type="button"
              className={`msd-content-tab ${
                activeTab === "reviews" ? "is-active" : ""
              }`}
              onClick={() => openContentTab("reviews")}
            >
              Reviews
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
                      className={`msd-season-card ${
                        season.complete ? "msd-season-complete" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="msd-season-toggle"
                        onClick={() => toggleSeason(season.seasonNumber)}
                      >
                        <div>
                          <div className="msd-season-title">{season.label}</div>
                          <div className="msd-season-subtitle">
                            {watchedLoaded
                              ? `${season.watchedCount}/${season.totalCount} watched`
                              : `Loading/${season.totalCount} watched`}
                          </div>
                        </div>
                        <div className="msd-season-toggle-right">
                          {season.complete ? (
                            <span className="msd-season-badge">Completed</span>
                          ) : null}
                          <span className="msd-season-chevron">
                            {expandedSeasons[season.seasonNumber] ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {expandedSeasons[season.seasonNumber] && (
                        <div className="msd-episode-list">
                          {season.episodes.map((ep) => {
                            const watched = isEpisodeWatched(ep, watchedLookup);
                            const hasMyEpisodeRating = myEpisodeRatings.has(
                              String(ep.id)
                            );
                            const myEpisodeRating = Number(
                              myEpisodeRatings.get(String(ep.id)) || 0
                            );
                            const draftEpisodeRating =
                              hoverEpisodeRatings[String(ep.id)];
                            const activeEpisodeRating = Number(
                              draftEpisodeRating !== undefined
                                ? draftEpisodeRating
                                : myEpisodeRating
                            );
                            const averageEpisodeRating =
                              episodeAverageRatings.get(String(ep.id));
                            const savingThisEpisode =
                              savingEpisodeRatingId === ep.id;
                            const isPickerOpen =
                              openEpisodeRatingPickerId === ep.id;
                            const isReviewOpen = openEpisodeReviewId === ep.id;

                            return (
                              <article
                                id={`episode-${ep.id}`}
                                key={ep.id}
                                className={`msd-episode-card ${
                                  watched ? "msd-episode-watched" : ""
                                }`}
                              >
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
                                  <div className="msd-episode-tmdb-rating">
                                    {ep.tmdbRating != null
                                      ? `${Math.round(ep.tmdbRating * 10)}%`
                                      : "-"}
                                  </div>

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

                                <div className="msd-episode-mobile-actions">
                                  <button
                                    type="button"
                                    className={`msd-btn ${
                                      watched
                                        ? "msd-btn-secondary"
                                        : "msd-btn-primary"
                                    }`}
                                    onClick={() => handleMarkWatched(ep)}
                                    disabled={!watchedLoaded}
                                  >
                                    {!watchedLoaded
                                      ? "Loading..."
                                      : watched
                                      ? "Watched"
                                      : "Watch"}
                                  </button>

                                  <button
                                    type="button"
                                    className="msd-btn msd-btn-secondary"
                                    onClick={() => handleWatchUpToHere(ep)}
                                    disabled={!watchedLoaded}
                                  >
                                    Up to Here
                                  </button>

                                  <button
                                    type="button"
                                    className="msd-btn msd-btn-secondary"
                                    onClick={() =>
                                      handleOpenEpisodeRatingPicker(ep.id)
                                    }
                                    disabled={savingThisEpisode}
                                  >
                                    {savingThisEpisode
                                      ? "Saving..."
                                      : hasMyEpisodeRating
                                      ? `${myEpisodeRating}%`
                                      : "Rate"}
                                  </button>

                                  <button
                                    type="button"
                                    className={`msd-btn ${
                                      isReviewOpen
                                        ? "msd-btn-primary"
                                        : "msd-btn-secondary"
                                    }`}
                                    onClick={() =>
                                      setOpenEpisodeReviewId((prev) =>
                                        prev === ep.id ? null : ep.id
                                      )
                                    }
                                  >
                                    Review
                                  </button>
                                </div>

                                {isPickerOpen ? (
                                  <div className="msd-mobile-rating-sheet">
                                    <div className="msd-rating-slider-wrap">
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={activeEpisodeRating}
                                        onChange={(event) =>
                                          setHoverEpisodeRatings((prev) => ({
                                            ...prev,
                                            [String(ep.id)]: event.target.value,
                                          }))
                                        }
                                        onMouseUp={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        onTouchEnd={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        onBlur={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        disabled={savingThisEpisode}
                                        className="msd-rating-slider"
                                        aria-label="Rate this episode from 0 to 100 percent"
                                      />
                                      <div className="msd-rating-slider-row">
                                        <span>0%</span>
                                        <strong>
                                          {savingThisEpisode
                                            ? "Saving..."
                                            : hasMyEpisodeRating
                                            ? `${myEpisodeRating}%`
                                            : "Not rated"}
                                        </strong>
                                        <span>100%</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

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
                                    expandedEpisodeOverviewIds[ep.id]
                                      ? "Hide episode overview"
                                      : "Show episode overview"
                                  }
                                >
                                  •••
                                </button>

                                {expandedEpisodeOverviewIds[ep.id] &&
                                ep.overview ? (
                                  <p className="msd-episode-overview msd-episode-overview-mobile-card">
                                    {ep.overview}
                                  </p>
                                ) : null}


                                {isReviewOpen ? (
                                  <EpisodeReviews
                                    episodeId={ep.id}
                                    currentUserId={currentUserId}
                                    episodeTitle={`${makeEpisodeCode(ep)} - ${ep.name}`}
                                  />
                                ) : null}

                                <div className="msd-episode-rating-desktop">
                                  <div className="msd-episode-rating-box">
                                    <div className="msd-episode-rating-header">
                                      <span className="msd-stat-label">
                                        Your Episode Rating
                                      </span>
                                      <span className="msd-episode-rating-meta">
                                        {savingThisEpisode
                                          ? "Saving..."
                                          : hasMyEpisodeRating
                                          ? `${myEpisodeRating}%`
                                          : "Not rated"}
                                      </span>
                                    </div>

                                    <div className="msd-rating-slider-wrap">
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={activeEpisodeRating}
                                        onChange={(event) =>
                                          setHoverEpisodeRatings((prev) => ({
                                            ...prev,
                                            [String(ep.id)]: event.target.value,
                                          }))
                                        }
                                        onMouseUp={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        onTouchEnd={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        onBlur={(event) =>
                                          handleSelectEpisodeRating(
                                            ep,
                                            event.currentTarget.value
                                          )
                                        }
                                        disabled={savingThisEpisode}
                                        className="msd-rating-slider"
                                        aria-label="Rate this episode from 0 to 100 percent"
                                      />
                                      <div className="msd-rating-slider-row">
                                        <span>0%</span>
                                        <strong>{activeEpisodeRating}%</strong>
                                        <span>100%</span>
                                      </div>
                                    </div>

                                    <div className="msd-episode-rating-footer">
                                      <span className="msd-muted">
                                        Average:{" "}
                                        {averageEpisodeRating
                                          ? `${averageEpisodeRating.avg}%`
                                          : "—"}
                                        {averageEpisodeRating
                                          ? ` (${averageEpisodeRating.count})`
                                          : ""}
                                      </span>
                                    </div>
                                  </div>
                                </div>
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
                    {cast.map((member, index) => {
                      const actorName =
                        member.personName || member.name || "Unknown actor";
                      const linkTarget = `/actor/${encodeURIComponent(
                        actorName
                      )}`;

                      return (
                        <Link
                          key={member.id || `${actorName}-${index}`}
                          to={linkTarget}
                          className="msd-cast-card msd-cast-card-mobile"
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          {member.image || member.profile_path ? (
                            <img
                              src={
                                member.image ||
                                (member.profile_path
                                  ? `https://image.tmdb.org/t/p/w500${member.profile_path}`
                                  : "")
                              }
                              alt={actorName}
                              className="msd-cast-image msd-cast-image-mobile"
                            />
                          ) : (
                            <div className="msd-cast-image msd-cast-image-mobile msd-cast-placeholder" />
                          )}
                          <div className="msd-cast-name">{actorName}</div>
                        </Link>
                      );
                    })}
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
                      const personName =
                        member.personName || member.name || "Unknown crew";
                      const roleName =
                        member.role ||
                        member.job ||
                        member.characterName ||
                        "Crew";

                      return (
                        <div
                          key={member.id || `${personName}-${roleName}-${index}`}
                          className="msd-cast-card msd-cast-card-mobile"
                        >
                          {member.image || member.profile_path ? (
                            <img
                              src={
                                member.image ||
                                (member.profile_path
                                  ? `https://image.tmdb.org/t/p/w500${member.profile_path}`
                                  : "")
                              }
                              alt={personName}
                              className="msd-cast-image msd-cast-image-mobile"
                            />
                          ) : (
                            <div className="msd-cast-image msd-cast-image-mobile msd-cast-placeholder" />
                          )}
                          <div className="msd-cast-name">{personName}</div>
                          <div className="msd-cast-role">{roleName}</div>
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

            {activeTab === "reviews" && (
              <ShowReviews showId={show.id} currentUserId={currentUserId} />
            )}          </div>
        </section>

        <section className="msd-panel">
          <h2 className="msd-section-title">Recommended Shows</h2>
          {extrasLoading ? (
  <p className="msd-muted">Loading recommendations...</p>
) : recommendedShows.filter((rec) => {
    const recTvdbId =
      rec?.resolved_tvdb_id ?? rec?.tvdb_id ?? rec?.tvdbId ?? null;

    if (!recTvdbId) return true;

    return !savedShowTvdbIds.has(String(recTvdbId));
  }).length > 0 ? (
  <div className="msd-recommended-row">
    {recommendedShows
      .filter((rec) => {
        const recTvdbId =
          rec?.resolved_tvdb_id ?? rec?.tvdb_id ?? rec?.tvdbId ?? null;

        if (!recTvdbId) return true;

        return !savedShowTvdbIds.has(String(recTvdbId));
      })
      .map((rec, index) => {
                const showName = rec.name || rec.title || "Unknown show";
                const recTvdbId =
                  rec?.resolved_tvdb_id ?? rec?.tvdb_id ?? rec?.tvdbId ?? null;
                const recTmdbId = rec?.tmdb_id ?? rec?.id ?? null;

                const linkTarget = recTvdbId
                  ? getMappedShowHref(rec)
                  : recTmdbId
                  ? `/show/tmdb/${recTmdbId}`
                  : getMappedShowHref(rec);

                const posterSrc =
                  rec.poster_url ||
                  rec.posterUrl ||
                  rec.image_url ||
                  rec.image ||
                  (rec.poster_path
                    ? `https://image.tmdb.org/t/p/w500${rec.poster_path}`
                    : "");

                return (
                  <Link
                    key={rec.id || `${showName}-${index}`}
                    to={linkTarget}
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


        {chatBoardOpen ? (
          <section className="msd-chatboard-screen" aria-label="Show chatboard">
            <div className="msd-chatboard-screen-head">
              <div>
                <p className="msd-chatboard-screen-kicker">Live chatboard</p>
                <h2>{show.name}</h2>
              </div>
              <button
                type="button"
                className="msd-chatboard-close"
                onClick={closeChatBoard}
                aria-label="Close chatboard"
              >
                ×
              </button>
            </div>
            <div className="msd-chatboard-screen-body">
              <ShowChatBoard showId={show.id} currentUserId={currentUserId} />
            </div>
          </section>
        ) : null}

        <div className="msd-bottom-action-bar">
          <button
            type="button"
            className="msd-bottom-action-btn"
            onClick={handleToggleRemoveShow}
            disabled={savingShowAction}
          >
            {savingShowAction ? "Saving..." : isRemoved ? "Add Back" : "Remove"}
          </button>

          <button
            type="button"
            className="msd-bottom-action-btn"
            onClick={handleToggleArchiveShow}
            disabled={savingShowAction || isRemoved}
          >
            {savingShowAction
              ? "Saving..."
              : isArchived
              ? "Unarchive"
              : "Archive"}
          </button>

          <button
            type="button"
            className={`msd-bottom-action-btn ${chatBoardOpen ? "is-active" : ""}`}
            onClick={openChatBoard}
          >
            Chatboard
          </button>

          {nextUnwatchedEpisode ? (
            <button
              type="button"
              className="msd-bottom-action-btn msd-bottom-action-btn-primary"
              onClick={handleMarkNextEpisodeWatched}
              disabled={!watchedLoaded}
            >
              Watch {makeEpisodeCode(nextUnwatchedEpisode)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
