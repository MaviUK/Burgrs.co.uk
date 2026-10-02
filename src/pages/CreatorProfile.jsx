import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./CreatorProfile.css";
import "./CreatorListCards.css";
import "./CreatorProfileStats.css";

const SYSTEM_ADMIN_USERNAME = "burgrs";
const BURGRS_TV_PROFILE_ID = "add17d5c-c8fd-4430-904f-271342100bf9";
const SYSTEM_ADMIN_ALIASES = new Set([SYSTEM_ADMIN_USERNAME, "admin"]);
const SYSTEM_ADMIN_PROFILE = Object.freeze({
  id: "burgrs-system-admin",
  username: SYSTEM_ADMIN_USERNAME,
  display_name: "BURGRS Admin",
  full_name: "BURGRS Admin",
  avatar_url: "",
  cover_url: "",
  bio: "The official BURGRS system profile. It automatically includes every show in the database, treats every episode as watched, and follows every creator.",
  creator_tagline: "Every show. Every episode. Every creator.",
  creator_niche: "Official system profile",
  creator_bio: "This profile is generated directly from the BURGRS database, so new shows, episodes and creator profiles appear here automatically without needing manual updates.",
  is_system_profile: true,
});
const SYSTEM_SHOW_PAGE_SIZE = 500;

function isSystemAdminSlug(value) {
  return SYSTEM_ADMIN_ALIASES.has(String(value || "").trim().toLowerCase());
}

function isProtectedBurgrsTvProfile(profile) {
  if (!profile) return false;
  if (String(profile.id || "") === BURGRS_TV_PROFILE_ID) return true;

  const names = [
    profile.username,
    profile.display_name,
    profile.full_name,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  return names.includes("burgrs tv");
}

function getName(profile) {
  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    "Creator"
  );
}

function getInitial(profile) {
  return getName(profile).slice(0, 1).toUpperCase();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return "";
  return `${Math.round(rating)}%`;
}

function formatPostType(value) {
  const labels = {
    post: "Post",
    hot_take: "Hot take",
    recommendation: "Recommendation",
    tonights_pick: "Tonight's pick",
    watchlist_advice: "Watchlist advice",
  };
  return labels[value] || "Post";
}

function showHref(show) {
  if (!show) return "#";
  const databaseShowId = show.show_id || show.id;
  if (databaseShowId) return `/show/${databaseShowId}`;
  if (show.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  return "#";
}

function creatorProfileHref(profile) {
  const slug = profile?.username || profile?.id;
  return slug ? `/u/${encodeURIComponent(slug)}` : "#";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function getShowYear(show) {
  return String(show?.first_aired || show?.show_year || "").slice(0, 4);
}

function isYouTubeEmbed(url) {
  return Boolean(url && url.includes("youtube.com/embed/"));
}

function isTikTokEmbed(url) {
  return Boolean(url && url.includes("tiktok.com/embed"));
}

function VideoEmbed({ post }) {
  const embedUrl = post?.video_embed_url;
  const originalUrl = post?.video_url || embedUrl;

  if (!embedUrl && !originalUrl) return null;

  if (isYouTubeEmbed(embedUrl)) {
    return (
      <div className="creator-video creator-video-youtube">
        <iframe
          src={embedUrl}
          title={post?.title || "YouTube video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  if (isTikTokEmbed(embedUrl)) {
    return (
      <div className="creator-video creator-video-tiktok">
        <iframe
          src={embedUrl}
          title={post?.title || "TikTok video"}
          allow="encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <a href={originalUrl} target="_blank" rel="noreferrer" className="creator-video-link">
      Watch video
    </a>
  );
}

function getPosterItems(items, limit = 8) {
  return (items || []).filter((item) => item?.poster_url).slice(0, limit);
}

function CreatorListCard({
  listId,
  title,
  subtitle,
  badge,
  description,
  items = [],
  isExpanded,
  onToggle,
  canDelete = false,
  onDelete,
  className = "",
}) {
  const posterItems = getPosterItems(items);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState("");
  const itemRefs = useRef(new Map());
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchMatches = normalizedQuery
    ? items
        .filter((item) =>
          String(item.show_name || "").toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 8)
    : [];

  function selectSearchResult(item) {
    const itemId = String(item.id);
    const row = itemRefs.current.get(itemId);
    setSearchQuery("");
    setHighlightedItemId(itemId);

    window.setTimeout(() => {
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 20);

    window.setTimeout(() => {
      setHighlightedItemId((current) => (current === itemId ? "" : current));
    }, 1800);
  }

  return (
    <article
      className={`creator-list-card creator-list-card-collapsed ${
        isExpanded ? "is-expanded" : ""
      } ${className}`.trim()}
    >
      <button
        type="button"
        className="creator-list-cover-button"
        onClick={() => onToggle(listId)}
        aria-expanded={isExpanded}
      >
        <div className="creator-list-cover-art" aria-hidden="true">
          {posterItems.length ? (
            <div className="creator-list-poster-collage">
              {posterItems.map((item, index) => (
                <img
                  key={`${listId}-poster-${item.show_id || item.id || index}`}
                  src={item.poster_url}
                  alt=""
                  loading="lazy"
                  className={`creator-list-collage-poster creator-list-collage-poster-${index + 1}`}
                />
              ))}
            </div>
          ) : (
            <div className="creator-list-poster-collage creator-list-poster-collage-empty">
              <span>TV</span>
            </div>
          )}
          <div className="creator-list-cover-shade" />
        </div>

        <div className="creator-list-cover-content">
          <div className="creator-list-cover-topline">
            <span>{badge}</span>
            <span>{isExpanded ? "Tap to close" : "Tap to expand"}</span>
          </div>

          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </div>
      </button>

      {isExpanded ? (
        <div className="creator-list-expanded-body">
          {description ? <p className="creator-list-description">{description}</p> : null}

          {items.length ? (
            <div className="creator-list-search">
              <label htmlFor={`creator-list-search-${listId}`}>Find a show in this list</label>
              <input
                id={`creator-list-search-${listId}`}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search this list..."
                autoComplete="off"
              />
              {normalizedQuery ? (
                <div className="creator-list-search-results">
                  {searchMatches.length ? (
                    searchMatches.map((item) => (
                      <button
                        key={`search-${item.id}`}
                        type="button"
                        className="creator-list-search-result"
                        onClick={() => selectSearchResult(item)}
                      >
                        <strong>#{item.rank}</strong>
                        <span>
                          {item.show_name}
                          {item.show_year ? <small>{item.show_year}</small> : null}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="creator-list-search-empty">No matching shows found</div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {items.length ? (
            <div className="creator-list-items">
              {items.map((item) => (
                <Link
                  key={item.id}
                  ref={(node) => {
                    const itemId = String(item.id);
                    if (node) itemRefs.current.set(itemId, node);
                    else itemRefs.current.delete(itemId);
                  }}
                  to={showHref(item)}
                  className={`creator-list-item${highlightedItemId === String(item.id) ? " is-search-highlight" : ""}`}
                >
                  <span className="creator-rank">#{item.rank}</span>
                  {item.poster_url ? (
                    <img src={item.poster_url} alt="" loading="lazy" />
                  ) : (
                    <span className="creator-mini-poster">?</span>
                  )}
                  <span>
                    <strong>{item.show_name}</strong>
                    {item.show_year ? <small>{item.show_year}</small> : null}
                    {item.note ? <em>{item.note}</em> : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="creator-muted">No shows added yet.</p>
          )}
        </div>
      ) : null}

      {canDelete ? (
        <button
          type="button"
          className="creator-delete-post-btn"
          onClick={() => onDelete(listId)}
        >
          Delete list
        </button>
      ) : null}
    </article>
  );
}

function ProfileList({ profiles, emptyText }) {
  if (!profiles.length) return <p className="creator-muted">{emptyText}</p>;

  return (
    <div className="creator-followers-list">
      {profiles.map((person) => {
        const personName = getName(person);
        const personInitial = getInitial(person);

        return (
          <Link key={person.id} to={creatorProfileHref(person)} className="creator-follower-row">
            {person.avatar_url ? (
              <img src={person.avatar_url} alt="" />
            ) : (
              <span>{personInitial}</span>
            )}
            <div>
              <strong>{personName}</strong>
              {person.username ? <small>@{person.username}</small> : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function CreatorProfile() {
  const { username } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [followLoading, setFollowLoading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [activeProfilePanel, setActiveProfilePanel] = useState("lists");
  const [monetization, setMonetization] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [posts, setPosts] = useState([]);
  const [lists, setLists] = useState([]);
  const [rankedTopShows, setRankedTopShows] = useState([]);
  const [systemStats, setSystemStats] = useState({ shows: 0, episodes: 0 });
  const [tasteMatch, setTasteMatch] = useState(null);
  const [tasteMatchLoading, setTasteMatchLoading] = useState(false);
  const [tasteSummary, setTasteSummary] = useState(null);
  const [tasteSummaryLoading, setTasteSummaryLoading] = useState(false);
  const [tasteDetailsOpen, setTasteDetailsOpen] = useState(false);
  const [tasteBrowseCategory, setTasteBrowseCategory] = useState("");
  const [tasteBrowseItems, setTasteBrowseItems] = useState([]);
  const [tasteBrowseLoading, setTasteBrowseLoading] = useState(false);
  const [tasteBrowseError, setTasteBrowseError] = useState("");
  const [tasteBrowsePage, setTasteBrowsePage] = useState(0);
  const [tasteBrowseHasMore, setTasteBrowseHasMore] = useState(false);
  const [tasteBrowseTotal, setTasteBrowseTotal] = useState(0);
  const [expandedListIds, setExpandedListIds] = useState(() => new Set());

  const isOwnProfile = useMemo(() => {
    if (!currentUser?.id || !profile?.id) return false;
    return String(currentUser.id) === String(profile.id);
  }, [currentUser?.id, profile?.id]);

  const isSubscribed = useMemo(() => {
    if (!subscription) return false;
    const validStatus = ["active", "trialing"].includes(subscription.status);
    const validPeriod =
      !subscription.current_period_end ||
      new Date(subscription.current_period_end) > new Date();
    return validStatus && validPeriod;
  }, [subscription]);

  const canSubscribe = useMemo(() => {
    return Boolean(
      !isOwnProfile &&
        monetization?.subscriptions_enabled &&
        monetization?.stripe_onboarding_complete
    );
  }, [isOwnProfile, monetization]);

  const libraryTasteScore = useMemo(() => {
    if (!tasteSummary) return null;

    const candidates = [
      { data: tasteSummary.total, weight: 45 },
      { data: tasteSummary.completed, weight: 30 },
      { data: tasteSummary.airing, weight: 20 },
      {
        data: tasteSummary.watching,
        weight: 5,
        minimumCombinedShows: 4,
      },
    ].filter(({ data, minimumCombinedShows = 0 }) => {
      if (!Number.isFinite(Number(data?.match))) return false;
      const combinedShows =
        Number(data?.count || 0) + Number(data?.viewerCount || 0);
      return combinedShows >= minimumCombinedShows;
    });

    if (!candidates.length) return null;

    const weightedTotal = candidates.reduce(
      (sum, item) => sum + Number(item.data.match) * item.weight,
      0
    );
    const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);

    return totalWeight ? Math.round(weightedTotal / totalWeight) : null;
  }, [tasteSummary]);

  const displayedTasteScore =
    tasteMatch?.score != null ? tasteMatch.score : libraryTasteScore;

  const tasteScoreIsProvisional =
    tasteMatch?.score == null && libraryTasteScore != null;

  const displayedTasteConfidence =
    tasteMatch?.score != null
      ? tasteMatch.confidence
      : libraryTasteScore != null
      ? "Library-based"
      : "Building your match";

  function getStatButtonClass(sectionName) {
    return activeProfilePanel === sectionName ? "is-active" : "";
  }

  function toggleListExpanded(listId) {
    setExpandedListIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  async function fetchAllSystemShows() {
    const rows = [];
    let from = 0;

    while (true) {
      const { data, error: showsError } = await supabase
        .from("shows")
        .select("id, tvdb_id, tmdb_id, name, first_aired, poster_url")
        .order("name", { ascending: true })
        .range(from, from + SYSTEM_SHOW_PAGE_SIZE - 1);

      if (showsError) throw showsError;

      const page = data || [];
      rows.push(...page);
      if (page.length < SYSTEM_SHOW_PAGE_SIZE) break;
      from += SYSTEM_SHOW_PAGE_SIZE;
    }

    return rows;
  }

  async function fetchAllSystemCreators() {
    const rows = [];
    let from = 0;

    while (true) {
      const { data, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, full_name, display_name, avatar_url")
        .not("username", "is", null)
        .order("username", { ascending: true })
        .range(from, from + SYSTEM_SHOW_PAGE_SIZE - 1);

      if (profilesError) throw profilesError;

      const page = data || [];
      rows.push(
        ...page.filter((profileRow) => String(profileRow?.username || "").trim())
      );
      if (page.length < SYSTEM_SHOW_PAGE_SIZE) break;
      from += SYSTEM_SHOW_PAGE_SIZE;
    }

    return rows;
  }

  async function loadSystemAdminProfile() {
    setProfile(SYSTEM_ADMIN_PROFILE);
    setFollowersCount(0);
    setFollowingCount(0);
    setFollowers([]);
    setFollowing([]);
    setIsFollowing(false);
    setMonetization(null);
    setSubscription(null);
    setPosts([]);
    setReviews([]);
    setRankedTopShows([]);
    setTasteMatch(null);
    setTasteMatchLoading(false);
    setTasteSummary(null);
    setTasteSummaryLoading(false);
    setTasteDetailsOpen(false);
    setTasteBrowseCategory("");
    setTasteBrowseItems([]);
    setTasteBrowseLoading(false);
    setTasteBrowseError("");
    setTasteBrowsePage(0);
    setTasteBrowseHasMore(false);
    setTasteBrowseTotal(0);

    const [showRows, creatorRows, episodeResult] = await Promise.all([
      fetchAllSystemShows(),
      fetchAllSystemCreators(),
      supabase.from("episodes").select("id", { count: "exact", head: true }),
    ]);

    if (episodeResult.error) throw episodeResult.error;

    const episodeCount = Number(episodeResult.count || 0);
    setSystemStats({ shows: showRows.length, episodes: episodeCount });
    setFollowing(creatorRows);
    setFollowingCount(creatorRows.length);

    const items = showRows.map((show, index) => ({
      id: `system-${show.id}`,
      show_id: show.id,
      rank: index + 1,
      show_name: show.name || "Untitled show",
      show_year: getShowYear(show),
      poster_url: show.poster_url || "",
      tmdb_id: show.tmdb_id || "",
      tvdb_id: show.tvdb_id || "",
      note: "Watched • Complete",
    }));

    setLists([
      {
        id: "system-all-shows",
        title: "Every show on BURGRS",
        subtitle: `${showRows.length.toLocaleString("en-GB")} shows • ${episodeCount.toLocaleString("en-GB")} episodes watched`,
        badge: "Auto",
        description:
          "This system collection mirrors the BURGRS database automatically. Every show currently in the database is included, every episode is treated as watched, every creator is followed, and future additions appear without manual maintenance.",
        visibility: "public",
        created_at: null,
        items,
      },
    ]);
  }

  async function loadRankedTopShows(profileRow) {
    try {
      const { data: rankingRows, error: rankingError } = await supabase
        .from("user_show_rankings")
        .select("show_id, ladder_position, wins, losses, comparisons, updated_at")
        .eq("user_id", profileRow.id)
        .not("ladder_position", "is", null)
        .order("ladder_position", { ascending: true })
        .limit(10);

      if (rankingError) {
        console.warn("Creator automatic ranking list fetch error:", rankingError);
        setRankedTopShows([]);
        return;
      }

      const rows = rankingRows || [];
      const showIds = rows.map((row) => row.show_id).filter(Boolean);
      if (!showIds.length) {
        setRankedTopShows([]);
        return;
      }

      const { data: showRows, error: showsError } = await supabase
        .from("shows")
        .select("id, name, first_aired, poster_url, tmdb_id")
        .in("id", showIds);

      if (showsError) {
        console.warn("Creator automatic ranking list show fetch error:", showsError);
        setRankedTopShows([]);
        return;
      }

      const showMap = new Map((showRows || []).map((show) => [String(show.id), show]));
      setRankedTopShows(
        rows
          .map((row, index) => {
            const show = showMap.get(String(row.show_id));
            if (!show) return null;

            return {
              id: `ranked-${row.show_id}`,
              show_id: row.show_id,
              rank: index + 1,
              show_name: show.name || "Untitled show",
              show_year: getShowYear(show),
              poster_url: show.poster_url || "",
              tmdb_id: show.tmdb_id || "",
              note: row.comparisons
                ? `${Number(row.comparisons || 0)} Rank'd comparison${Number(row.comparisons || 0) === 1 ? "" : "s"}`
                : "From Rank'd",
            };
          })
          .filter(Boolean)
      );
    } catch (err) {
      console.warn("Failed loading automatic creator ranking list:", err);
      setRankedTopShows([]);
    }
  }

  async function loadCreatorLists(profileRow, user) {
    const canViewPrivateLists = Boolean(user?.id && user.id === profileRow.id);

    try {
      let listQuery = supabase
        .from("creator_lists")
        .select("id, user_id, title, description, list_type, visibility, created_at, updated_at")
        .eq("user_id", profileRow.id)
        .order("created_at", { ascending: false })
        .limit(12);

      if (!canViewPrivateLists) listQuery = listQuery.eq("visibility", "public");

      const { data: listRows, error: listError } = await listQuery;
      if (listError) {
        console.warn("Creator lists fetch error:", listError);
        setLists([]);
        return;
      }

      const rows = listRows || [];
      if (!rows.length) {
        setLists([]);
        return;
      }

      const listIds = rows.map((list) => list.id);
      const { data: itemRows, error: itemsError } = await supabase
        .from("creator_list_items")
        .select("id, list_id, rank, show_id, show_name, show_year, poster_url, tmdb_id, note")
        .in("list_id", listIds)
        .order("rank", { ascending: true });

      if (itemsError) {
        console.warn("Creator list items fetch error:", itemsError);
        setLists(rows.map((list) => ({ ...list, items: [] })));
        return;
      }

      const itemsByListId = new Map();
      (itemRows || []).forEach((item) => {
        const key = String(item.list_id);
        const currentItems = itemsByListId.get(key) || [];
        currentItems.push(item);
        itemsByListId.set(key, currentItems);
      });

      setLists(
        rows.map((list) => ({
          ...list,
          items: itemsByListId.get(String(list.id)) || [],
        }))
      );
    } catch (err) {
      console.warn("Failed loading creator lists:", err);
      setLists([]);
    }
  }

  async function loadFollowers(profileRow) {
    try {
      const { data: followRows, error: followError } = await supabase
        .from("user_follows")
        .select("follower_id, created_at")
        .eq("following_id", profileRow.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (followError) throw followError;

      const followerIds = (followRows || [])
        .map((row) => row.follower_id)
        .filter(Boolean);

      if (!followerIds.length) {
        setFollowers([]);
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, full_name, display_name, avatar_url")
        .in("id", followerIds);

      if (profileError) throw profileError;

      const profileMap = new Map((profileRows || []).map((row) => [String(row.id), row]));
      setFollowers(followerIds.map((id) => profileMap.get(String(id))).filter(Boolean));
    } catch (err) {
      console.warn("Failed loading followers:", err);
      setFollowers([]);
    }
  }

  async function loadFollowing(profileRow) {
    try {
      const { data: followRows, error: followError } = await supabase
        .from("user_follows")
        .select("following_id, created_at")
        .eq("follower_id", profileRow.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (followError) throw followError;

      const followingIds = (followRows || [])
        .map((row) => row.following_id)
        .filter(Boolean);

      if (!followingIds.length) {
        setFollowing([]);
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, full_name, display_name, avatar_url")
        .in("id", followingIds);

      if (profileError) throw profileError;

      const profileMap = new Map((profileRows || []).map((row) => [String(row.id), row]));
      setFollowing(followingIds.map((id) => profileMap.get(String(id))).filter(Boolean));
    } catch (err) {
      console.warn("Failed loading following:", err);
      setFollowing([]);
    }
  }

  async function loadTasteBrowse(category, append = false) {
    if (!currentUser?.id || !profile?.id || tasteBrowseLoading) return;

    if (!append && tasteBrowseCategory === category) {
      setTasteBrowseCategory("");
      setTasteBrowseItems([]);
      setTasteBrowseError("");
      setTasteBrowsePage(0);
      setTasteBrowseHasMore(false);
      setTasteBrowseTotal(0);
      return;
    }

    const nextPage = append ? tasteBrowsePage + 1 : 1;
    setTasteDetailsOpen(false);
    setTasteBrowseCategory(category);
    setTasteBrowseLoading(true);
    setTasteBrowseError("");

    if (!append) {
      setTasteBrowseItems([]);
      setTasteBrowsePage(0);
      setTasteBrowseHasMore(false);
      setTasteBrowseTotal(0);
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("You must be logged in.");

      const response = await fetch("/.netlify/functions/taste-match-shows", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetUserId: profile.id,
          category,
          page: nextPage,
          pageSize: 48,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || "Could not load shows.");
      }

      const incoming = result?.items || [];
      setTasteBrowseItems((current) =>
        append ? [...current, ...incoming] : incoming
      );
      setTasteBrowsePage(Number(result?.page || nextPage));
      setTasteBrowseHasMore(Boolean(result?.hasMore));
      setTasteBrowseTotal(Number(result?.total || incoming.length));
    } catch (err) {
      console.warn("Failed loading profile shows:", err);
      setTasteBrowseError(err.message || "Could not load shows.");
      if (!append) setTasteBrowseItems([]);
    } finally {
      setTasteBrowseLoading(false);
    }
  }

  async function loadTasteSummary(profileRow, user) {
    setTasteSummary(null);

    if (!user?.id || !profileRow?.id || String(user.id) === String(profileRow.id)) {
      setTasteSummaryLoading(false);
      return;
    }

    setTasteSummaryLoading(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("You must be logged in.");

      const response = await fetch("/.netlify/functions/taste-match-summary", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetUserId: profileRow.id }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || "Could not calculate show overlap.");
      }

      setTasteSummary(result?.categories || null);
    } catch (err) {
      console.warn("Failed loading Taste Match summary:", err);
      setTasteSummary(null);
    } finally {
      setTasteSummaryLoading(false);
    }
  }

  async function loadTasteMatch(profileRow, user) {
    setTasteMatch(null);

    if (!user?.id || !profileRow?.id || String(user.id) === String(profileRow.id)) {
      setTasteMatchLoading(false);
      return;
    }

    setTasteMatchLoading(true);

    try {
      async function fetchPaged(makeQuery) {
        const rows = [];
        const pageSize = 1000;
        let from = 0;

        while (true) {
          const { data, error } = await makeQuery(from, from + pageSize - 1);
          if (error) throw error;

          const page = data || [];
          rows.push(...page);
          if (page.length < pageSize) break;
          from += pageSize;
        }

        return rows;
      }

      const [
        myRatingRows,
        theirRatingRows,
        myRankingRows,
        theirRankingRows,
      ] = await Promise.all([
        fetchPaged((from, to) =>
          supabase
            .from("burgr_ratings")
            .select("show_id, rating")
            .eq("user_id", user.id)
            .order("show_id", { ascending: true })
            .range(from, to)
        ),
        fetchPaged((from, to) =>
          supabase
            .from("burgr_ratings")
            .select("show_id, rating")
            .eq("user_id", profileRow.id)
            .order("show_id", { ascending: true })
            .range(from, to)
        ),
        fetchPaged((from, to) =>
          supabase
            .from("user_show_rankings")
            .select("show_id, ladder_position")
            .eq("user_id", user.id)
            .not("ladder_position", "is", null)
            .order("ladder_position", { ascending: true })
            .range(from, to)
        ),
        fetchPaged((from, to) =>
          supabase
            .from("user_show_rankings")
            .select("show_id, ladder_position")
            .eq("user_id", profileRow.id)
            .not("ladder_position", "is", null)
            .order("ladder_position", { ascending: true })
            .range(from, to)
        ),
      ]);

      const myRatings = new Map(
        myRatingRows.map((row) => [String(row.show_id), Number(row.rating)])
      );
      const theirRatings = new Map(
        theirRatingRows.map((row) => [String(row.show_id), Number(row.rating)])
      );

      const sharedRatings = [];
      myRatings.forEach((myRating, showId) => {
        const theirRating = theirRatings.get(showId);
        if (!Number.isFinite(myRating) || !Number.isFinite(theirRating)) return;

        sharedRatings.push({
          show_id: showId,
          my_rating: myRating,
          their_rating: theirRating,
          difference: Math.abs(myRating - theirRating),
          average: (myRating + theirRating) / 2,
        });
      });

      const ratingSimilarity = sharedRatings.length
        ? sharedRatings.reduce(
            (sum, item) => sum + Math.max(0, 100 - item.difference),
            0
          ) / sharedRatings.length
        : null;

      const myRankings = myRankingRows;
      const theirRankings = theirRankingRows;

      const myRankMap = new Map(
        myRankings.map((row, index) => [
          String(row.show_id),
          {
            position: Number(row.ladder_position) || index + 1,
            percentile:
              myRankings.length <= 1
                ? 0
                : index / Math.max(1, myRankings.length - 1),
          },
        ])
      );

      const theirRankMap = new Map(
        theirRankings.map((row, index) => [
          String(row.show_id),
          {
            position: Number(row.ladder_position) || index + 1,
            percentile:
              theirRankings.length <= 1
                ? 0
                : index / Math.max(1, theirRankings.length - 1),
          },
        ])
      );

      const sharedRanked = [];
      myRankMap.forEach((myRank, showId) => {
        const theirRank = theirRankMap.get(showId);
        if (!theirRank) return;

        sharedRanked.push({
          show_id: showId,
          my_position: myRank.position,
          their_position: theirRank.position,
          similarity: Math.max(
            0,
            100 - Math.abs(myRank.percentile - theirRank.percentile) * 100
          ),
        });
      });

      const rankSimilarity =
        sharedRanked.length >= 2
          ? sharedRanked.reduce((sum, item) => sum + item.similarity, 0) /
            sharedRanked.length
          : null;

      const myFavourites = new Set(
        [...myRatings.entries()]
          .filter(([, rating]) => rating >= 80)
          .map(([showId]) => showId)
      );

      const theirFavourites = new Set(
        [...theirRatings.entries()]
          .filter(([, rating]) => rating >= 80)
          .map(([showId]) => showId)
      );

      const sharedFavouriteIds = [...myFavourites].filter((showId) =>
        theirFavourites.has(showId)
      );

      const favouriteBase = Math.min(myFavourites.size, theirFavourites.size);
      const favouriteSimilarity = favouriteBase
        ? (sharedFavouriteIds.length / favouriteBase) * 100
        : null;

      const components = [];
      if (ratingSimilarity != null) components.push({ value: ratingSimilarity, weight: 70 });
      if (rankSimilarity != null) components.push({ value: rankSimilarity, weight: 20 });
      if (favouriteSimilarity != null) {
        components.push({ value: favouriteSimilarity, weight: 10 });
      }

      const weightedScore = components.length
        ? components.reduce((sum, item) => sum + item.value * item.weight, 0) /
          components.reduce((sum, item) => sum + item.weight, 0)
        : null;

      const score =
        sharedRatings.length >= 3 && weightedScore != null
          ? Math.round(weightedScore)
          : null;

      const confidence =
        sharedRatings.length >= 20
          ? "High confidence"
          : sharedRatings.length >= 10
          ? "Good confidence"
          : sharedRatings.length >= 5
          ? "Growing confidence"
          : sharedRatings.length >= 3
          ? "Early match"
          : "Not enough shared ratings";

      const closestMatches = [...sharedRatings]
        .sort((a, b) => a.difference - b.difference || b.average - a.average)
        .slice(0, 3);

      const biggestDisagreements = [...sharedRatings]
        .sort((a, b) => b.difference - a.difference || b.average - a.average)
        .slice(0, 3);

      const sharedFavouriteItems = sharedRatings
        .filter((item) => item.my_rating >= 80 && item.their_rating >= 80)
        .sort((a, b) => b.average - a.average)
        .slice(0, 6);

      const recommendationsForMe = [...theirRatings.entries()]
        .filter(([showId, rating]) => rating >= 80 && !myRatings.has(showId))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([showId, rating]) => ({
          show_id: showId,
          their_rating: rating,
        }));

      const recommendationsForThem = [...myRatings.entries()]
        .filter(([showId, rating]) => rating >= 80 && !theirRatings.has(showId))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([showId, rating]) => ({
          show_id: showId,
          my_rating: rating,
        }));

      const myTop10 = new Set(
        myRankings.slice(0, 10).map((row) => String(row.show_id))
      );
      const theirTop10 = new Set(
        theirRankings.slice(0, 10).map((row) => String(row.show_id))
      );
      const myTop25 = new Set(
        myRankings.slice(0, 25).map((row) => String(row.show_id))
      );
      const theirTop25 = new Set(
        theirRankings.slice(0, 25).map((row) => String(row.show_id))
      );

      const sharedTop10 = [...myTop10].filter((showId) => theirTop10.has(showId)).length;
      const sharedTop25 = [...myTop25].filter((showId) => theirTop25.has(showId)).length;

      const detailIds = Array.from(
        new Set(
          [
            ...sharedRatings.map((item) => item.show_id),
            ...recommendationsForMe.map((item) => item.show_id),
            ...recommendationsForThem.map((item) => item.show_id),
          ].filter(Boolean)
        )
      );

      const showMap = new Map();

      for (let index = 0; index < detailIds.length; index += 100) {
        const batch = detailIds.slice(index, index + 100);
        const { data: showRows, error: showError } = await supabase
          .from("shows")
          .select("id, name, first_aired, poster_url, tmdb_id, genres")
          .in("id", batch);

        if (showError) throw showError;
        (showRows || []).forEach((show) => showMap.set(String(show.id), show));
      }

      const genreStats = new Map();

      sharedRatings.forEach((item) => {
        const show = showMap.get(String(item.show_id));
        const genres = Array.isArray(show?.genres) ? show.genres : [];

        genres.forEach((genreValue) => {
          const genre = String(genreValue || "").trim();
          if (!genre) return;

          const current = genreStats.get(genre) || {
            genre,
            count: 0,
            myTotal: 0,
            theirTotal: 0,
          };

          current.count += 1;
          current.myTotal += item.my_rating;
          current.theirTotal += item.their_rating;
          genreStats.set(genre, current);
        });
      });

      const genreMatches = [...genreStats.values()]
        .filter((item) => item.count >= 2)
        .map((item) => {
          const myAverage = item.myTotal / item.count;
          const theirAverage = item.theirTotal / item.count;
          return {
            genre: item.genre,
            count: item.count,
            myAverage: Math.round(myAverage),
            theirAverage: Math.round(theirAverage),
            match: Math.round(Math.max(0, 100 - Math.abs(myAverage - theirAverage))),
          };
        })
        .sort((a, b) => b.count - a.count || b.match - a.match)
        .slice(0, 6);

      const attachShow = (item) => {
        if (!item) return null;
        return {
          ...item,
          show: showMap.get(String(item.show_id)) || null,
        };
      };

      setTasteMatch({
        score,
        confidence,
        sharedRatings: sharedRatings.length,
        sharedRanked: sharedRanked.length,
        sharedFavourites: sharedFavouriteIds.length,
        ratingSimilarity:
          ratingSimilarity == null ? null : Math.round(ratingSimilarity),
        rankSimilarity:
          rankSimilarity == null ? null : Math.round(rankSimilarity),
        favouriteSimilarity:
          favouriteSimilarity == null ? null : Math.round(favouriteSimilarity),
        sharedTop10,
        sharedTop25,
        genreMatches,
        closestMatches: closestMatches.map(attachShow),
        biggestDisagreements: biggestDisagreements.map(attachShow),
        sharedFavouriteItems: sharedFavouriteItems.map(attachShow),
        recommendationsForMe: recommendationsForMe.map(attachShow),
        recommendationsForThem: recommendationsForThem.map(attachShow),
      });
    } catch (err) {
      console.warn("Failed loading Taste Match:", err);
      setTasteMatch(null);
    } finally {
      setTasteMatchLoading(false);
    }
  }
  async function loadCreatorProfile() {
    setLoading(true);
    setError("");

    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user || null;
      setCurrentUser(user);

      const cleanUsername = decodeURIComponent(username || "").replace(/^@/, "");

      if (isSystemAdminSlug(cleanUsername)) {
        await loadSystemAdminProfile();
        return;
      }

      const profileSelect = `
        id,
        username,
        full_name,
        display_name,
        avatar_url,
        cover_url,
        bio,
        creator_tagline,
        creator_niche,
        creator_bio
      `;

      let { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select(profileSelect)
        .eq("username", cleanUsername)
        .maybeSingle();

      if (!profileRow && !profileError && isUuid(cleanUsername)) {
        const fallbackResult = await supabase
          .from("profiles")
          .select(profileSelect)
          .eq("id", cleanUsername)
          .maybeSingle();
        profileRow = fallbackResult.data;
        profileError = fallbackResult.error;
      }

      if (profileError) throw profileError;
      if (!profileRow) {
        setProfile(null);
        setError("Creator profile not found.");
        return;
      }

      setProfile(profileRow);

      const [
        { count: followerCount },
        { count: followingTotal },
        { data: followingRow },
        monetizationResult,
        subscriptionResult,
      ] = await Promise.all([
        supabase
          .from("user_follows")
          .select("follower_id", { count: "exact", head: true })
          .eq("following_id", profileRow.id),
        supabase
          .from("user_follows")
          .select("following_id", { count: "exact", head: true })
          .eq("follower_id", profileRow.id),
        user?.id
          ? supabase
              .from("user_follows")
              .select("follower_id")
              .eq("follower_id", user.id)
              .eq("following_id", profileRow.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("creator_monetization")
          .select("*")
          .eq("user_id", profileRow.id)
          .maybeSingle(),
        user?.id && user.id !== profileRow.id
          ? supabase
              .from("creator_subscriptions")
              .select("*")
              .eq("creator_id", profileRow.id)
              .eq("subscriber_id", user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (monetizationResult.error) {
        console.error("Monetization fetch error:", monetizationResult.error);
      }
      if (subscriptionResult.error) {
        console.error("Subscription fetch error:", subscriptionResult.error);
      }

      setFollowersCount(followerCount || 0);
      setFollowingCount(followingTotal || 0);
      setIsFollowing(Boolean(followingRow));
      setMonetization(monetizationResult.data || null);
      setSubscription(subscriptionResult.data || null);

      await Promise.all([
        loadFollowers(profileRow),
        loadFollowing(profileRow),
        loadRankedTopShows(profileRow),
        loadCreatorLists(profileRow, user),
        loadTasteMatch(profileRow, user),
        loadTasteSummary(profileRow, user),
      ]);

      const { data: postRows, error: postsError } = await supabase
        .from("creator_posts")
        .select(`
          id,
          user_id,
          title,
          body,
          post_type,
          visibility,
          video_url,
          video_provider,
          video_embed_url,
          image_url,
          is_auto_news,
          source_name,
          source_url,
          related_show_id,
          created_at,
          updated_at
        `)
        .eq("user_id", profileRow.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (postsError) throw postsError;
      setPosts(postRows || []);

      const { data: reviewRows, error: reviewsError } = await supabase
        .from("show_reviews")
        .select(`
          id,
          show_id,
          body,
          created_at,
          shows:show_id (
            id,
            name,
            first_aired,
            tmdb_id,
            poster_url,
            backdrop_url
          )
        `)
        .eq("user_id", profileRow.id)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(20);

      if (reviewsError) throw reviewsError;

      const rows = reviewRows || [];
      const reviewShowIds = Array.from(
        new Set(rows.map((review) => review.show_id).filter(Boolean))
      );
      let ratingMap = new Map();

      if (reviewShowIds.length) {
        const { data: ratingRows, error: ratingsError } = await supabase
          .from("burgr_ratings")
          .select("show_id, rating")
          .eq("user_id", profileRow.id)
          .in("show_id", reviewShowIds);

        if (ratingsError) {
          console.warn("Creator review ratings fetch error:", ratingsError);
        } else {
          ratingMap = new Map(
            (ratingRows || []).map((row) => [String(row.show_id), row.rating])
          );
        }
      }

      setReviews(
        rows.map((review) => ({
          ...review,
          user_rating: ratingMap.get(String(review.show_id)) ?? null,
        }))
      );
    } catch (err) {
      console.error("Failed loading creator profile:", err);
      setError(err.message || "Failed loading creator profile.");
    } finally {
      setLoading(false);
      setSubscriptionLoading(false);
    }
  }

  useEffect(() => {
    setExpandedListIds(new Set());
    setActiveProfilePanel("lists");
    setTasteBrowseCategory("");
    setTasteBrowseItems([]);
    setTasteBrowseError("");
    setTasteBrowsePage(0);
    setTasteBrowseHasMore(false);
    setTasteBrowseTotal(0);
    setTasteDetailsOpen(false);
    loadCreatorProfile();
  }, [username]);

  async function handleSubscribe() {
    if (!currentUser?.id) {
      setError("Please sign in to subscribe.");
      return;
    }
    if (!profile?.id || !canSubscribe) return;
    setError("Stripe checkout is the next step.");
  }

  async function handleDeletePost(postId) {
    if (!currentUser?.id || !profile?.id || !isOwnProfile) return;
    const confirmed = window.confirm("Delete this post?");
    if (!confirmed) return;
    setError("");

    try {
      const { error: deleteError } = await supabase
        .from("creator_posts")
        .delete()
        .eq("id", postId)
        .eq("user_id", currentUser.id);

      if (deleteError) throw deleteError;
      setPosts((currentPosts) => currentPosts.filter((post) => post.id !== postId));
    } catch (err) {
      console.error("Failed deleting creator post:", err);
      setError(err.message || "Could not delete post.");
    }
  }

  async function handleDeleteList(listId) {
    if (!currentUser?.id || !profile?.id || !isOwnProfile) return;
    const confirmed = window.confirm("Delete this list?");
    if (!confirmed) return;
    setError("");

    try {
      const { error: deleteError } = await supabase
        .from("creator_lists")
        .delete()
        .eq("id", listId)
        .eq("user_id", currentUser.id);

      if (deleteError) throw deleteError;
      setLists((currentLists) => currentLists.filter((list) => list.id !== listId));
      setExpandedListIds((current) => {
        const next = new Set(current);
        next.delete(listId);
        return next;
      });
    } catch (err) {
      console.error("Failed deleting creator list:", err);
      setError(err.message || "Could not delete list.");
    }
  }

  async function toggleFollow() {
    if (
      !currentUser?.id ||
      !profile?.id ||
      isOwnProfile ||
      followLoading ||
      isProtectedBurgrsTvProfile(profile)
    ) {
      return;
    }
    setFollowLoading(true);
    setError("");

    try {
      if (isFollowing) {
        const { error: deleteError } = await supabase
          .from("user_follows")
          .delete()
          .eq("follower_id", currentUser.id)
          .eq("following_id", profile.id);
        if (deleteError) throw deleteError;
        setIsFollowing(false);
        setFollowersCount((count) => Math.max(0, count - 1));
      } else {
        const { error: insertError } = await supabase.from("user_follows").insert({
          follower_id: currentUser.id,
          following_id: profile.id,
        });
        if (insertError) throw insertError;
        setIsFollowing(true);
        setFollowersCount((count) => count + 1);
      }

      await loadFollowers(profile);
    } catch (err) {
      console.error("Failed updating follow:", err);
      setError(err.message || "Could not update follow.");
    } finally {
      setFollowLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="creator-page">
        <p className="creator-muted">Loading creator...</p>
      </main>
    );
  }

  if (error && !profile) {
    return (
      <main className="creator-page">
        <p className="creator-error">{error}</p>
      </main>
    );
  }

  const isSystemProfile = Boolean(profile?.is_system_profile);
  const isProtectedBurgrsTv = isProtectedBurgrsTvProfile(profile);
  const displayName = getName(profile);
  const handle = profile?.username ? `@${profile.username}` : "";
  const avatarUrl = profile?.avatar_url || "";
  const coverUrl = profile?.cover_url || "";
  const tagline =
    profile?.creator_tagline ||
    profile?.creator_niche ||
    profile?.bio ||
    "Follow my TV reviews, posts and recommendations.";
  const creatorBio = profile?.creator_bio || profile?.bio || "";
  const listCount = lists.length + (rankedTopShows.length ? 1 : 0);

  return (
    <main className="creator-page">
      <section className="creator-hero">
        <div
          className="creator-cover"
          style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
        />

        <div className="creator-hero-content">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="creator-avatar" />
          ) : (
            <div className="creator-avatar creator-avatar-fallback">
              {getInitial(profile)}
            </div>
          )}

          <h1>{displayName}</h1>
          {handle ? <p className="creator-handle">{handle}</p> : null}
          <p className="creator-tagline">{tagline}</p>

          {profile?.creator_niche ? (
            <p className="creator-niche-pill">{profile.creator_niche}</p>
          ) : null}

          <div className="creator-actions">
            {isSystemProfile ? (
              <span className="creator-btn creator-btn-secondary" aria-label="Official BURGRS system profile">
                Official BURGRS profile
              </span>
            ) : isOwnProfile ? (
              <>
                <Link to="/profile/edit" className="creator-btn creator-btn-secondary">
                  Edit profile
                </Link>
                <Link to="/creator/posts/new" className="creator-btn creator-btn-primary">
                  Create post
                </Link>
                <Link to="/creator/lists/new" className="creator-btn creator-btn-secondary">
                  Create list
                </Link>
              </>
            ) : isProtectedBurgrsTv ? (
              <button
                type="button"
                className="creator-btn creator-btn-secondary"
                disabled
                aria-label="Burgrs TV is always followed"
              >
                Following
              </button>
            ) : (
              <button
                type="button"
                className={`creator-btn ${isFollowing ? "creator-btn-secondary" : "creator-btn-primary"}`}
                onClick={toggleFollow}
                disabled={followLoading}
              >
                {followLoading ? "Saving..." : isFollowing ? "Following" : "Follow"}
              </button>
            )}

            {!isOwnProfile && !isSystemProfile ? (
              isSubscribed ? (
                <button type="button" className="creator-btn creator-btn-secondary" disabled>
                  Subscribed
                </button>
              ) : canSubscribe ? (
                <button
                  type="button"
                  className="creator-btn creator-btn-primary"
                  onClick={handleSubscribe}
                  disabled={subscriptionLoading}
                >
                  Subscribe £{(monetization.monthly_price_pence / 100).toFixed(2)}/month
                </button>
              ) : (
                <button type="button" className="creator-btn creator-btn-locked" disabled>
                  Subscribe soon
                </button>
              )
            ) : null}
          </div>
        </div>
      </section>

      {error ? <p className="creator-error">{error}</p> : null}

      {isSystemProfile ? (
        <section
          className="creator-stats-card creator-stats-card-clickable creator-system-stats"
          aria-label="BURGRS system profile stats"
        >
          <button
            type="button"
            className={getStatButtonClass("following")}
            onClick={() => setActiveProfilePanel("following")}
          >
            <strong>{followingCount.toLocaleString("en-GB")}</strong>
            <span>Creators followed</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("lists")}
            onClick={() => setActiveProfilePanel("lists")}
          >
            <strong>{systemStats.shows.toLocaleString("en-GB")}</strong>
            <span>Shows</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("lists")}
            onClick={() => setActiveProfilePanel("lists")}
          >
            <strong>{systemStats.episodes.toLocaleString("en-GB")}</strong>
            <span>Episodes watched</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("lists")}
            onClick={() => setActiveProfilePanel("lists")}
          >
            <strong>100%</strong>
            <span>Complete</span>
          </button>
        </section>
      ) : (
        <section className="creator-stats-card creator-stats-card-clickable" aria-label="Creator profile sections">
          <button
            type="button"
            className={getStatButtonClass("followers")}
            onClick={() => setActiveProfilePanel("followers")}
          >
            <strong>{followersCount}</strong>
            <span>Followers</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("following")}
            onClick={() => setActiveProfilePanel("following")}
          >
            <strong>{followingCount}</strong>
            <span>Following</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("posts")}
            onClick={() => setActiveProfilePanel("posts")}
          >
            <strong>{posts.length}</strong>
            <span>Posts</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("lists")}
            onClick={() => setActiveProfilePanel("lists")}
          >
            <strong>{listCount}</strong>
            <span>Lists</span>
          </button>
          <button
            type="button"
            className={getStatButtonClass("reviews")}
            onClick={() => setActiveProfilePanel("reviews")}
          >
            <strong>{reviews.length}</strong>
            <span>Reviews</span>
          </button>
        </section>
      )}

      {!isSystemProfile && !isOwnProfile && currentUser?.id ? (
        <section className="creator-taste-strip" aria-label="Taste Match comparison">
          {[
            {
              key: "total",
              label: "Total shows",
              count: tasteSummary?.total?.count,
              match: tasteSummary?.total?.match,
            },
            {
              key: "completed",
              label: "Completed",
              count: tasteSummary?.completed?.count,
              match: tasteSummary?.completed?.match,
            },
            {
              key: "watching",
              label: "Watching",
              count: tasteSummary?.watching?.count,
              match: tasteSummary?.watching?.match,
            },
            {
              key: "airing",
              label: "Airing",
              count: tasteSummary?.airing?.count,
              match: tasteSummary?.airing?.match,
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`creator-taste-strip-item creator-taste-strip-button${tasteBrowseCategory === item.key ? " is-active" : ""}`}
              onClick={() => loadTasteBrowse(item.key)}
              aria-pressed={tasteBrowseCategory === item.key}
            >
              <strong>
                {tasteSummaryLoading ? "…" : item.count ?? "--"}
              </strong>
              <span>{item.label}</span>
              <small>
                {tasteSummaryLoading
                  ? "Comparing"
                  : item.match == null
                  ? "No overlap yet"
                  : `${item.match}% match`}
              </small>
            </button>
          ))}

          <button
            type="button"
            className={`creator-taste-strip-item creator-taste-strip-overall creator-taste-overall${tasteDetailsOpen ? " is-active" : ""}`}
            onClick={() => {
              const next = !tasteDetailsOpen;
              setTasteDetailsOpen(next);
              if (next) {
                setTasteBrowseCategory("");
                setTasteBrowseItems([]);
                setTasteBrowseError("");
                setTasteBrowsePage(0);
                setTasteBrowseHasMore(false);
                setTasteBrowseTotal(0);
              }
            }}
            aria-pressed={tasteDetailsOpen}
          >
            <strong>
              {tasteMatchLoading
                ? "…"
                : displayedTasteScore == null
                ? "--"
                : `${displayedTasteScore}%`}
            </strong>
            <span>Taste match</span>
            <small>
              {tasteMatchLoading
                ? "Comparing"
                : displayedTasteScore == null
                ? "Building match"
                : displayedTasteConfidence}
            </small>
          </button>
        </section>
      ) : null}

      {tasteDetailsOpen ? (
        <section className="creator-card creator-taste-match creator-taste-details">
          <div className="creator-taste-match-head">
            <div>
              <span className="creator-taste-eyebrow">Taste Match</span>
              <h2>You + {displayName}</h2>
              <p className="creator-taste-detail-intro">
                Ratings drive the score, with Rank'd order and shared favourites refining the match.
              </p>
            </div>
            <div className={`creator-taste-score${displayedTasteScore == null ? " is-empty" : ""}`}>
              <strong>{displayedTasteScore == null ? "--" : `${displayedTasteScore}%`}</strong>
              <span>{displayedTasteConfidence}</span>
            </div>
          </div>

          {tasteMatchLoading ? (
            <p className="creator-muted">Comparing your TV taste...</p>
          ) : tasteMatch ? (
            <>
              <div className="creator-taste-metrics">
                <div>
                  <strong>{tasteMatch.sharedRatings}</strong>
                  <span>Shared ratings</span>
                </div>
                <div>
                  <strong>{tasteMatch.ratingSimilarity == null ? "--" : `${tasteMatch.ratingSimilarity}%`}</strong>
                  <span>Rating similarity</span>
                </div>
                <div>
                  <strong>{tasteMatch.rankSimilarity == null ? "--" : `${tasteMatch.rankSimilarity}%`}</strong>
                  <span>Rank'd similarity</span>
                </div>
                <div>
                  <strong>{tasteMatch.sharedFavourites}</strong>
                  <span>Shared favourites</span>
                </div>
              </div>

              <div className="creator-taste-rank-summary">
                <div>
                  <strong>{tasteMatch.sharedTop10}</strong>
                  <span>Shared Top 10</span>
                </div>
                <div>
                  <strong>{tasteMatch.sharedTop25}</strong>
                  <span>Shared Top 25</span>
                </div>
                <div>
                  <strong>{tasteMatch.sharedRanked}</strong>
                  <span>Shared Rank'd shows</span>
                </div>
              </div>

              <div className="creator-taste-detail-section creator-taste-library-compare">
                <div className="creator-section-head">
                  <h3>Library comparison</h3>
                  <span>Tap a section to browse the shows</span>
                </div>
                <div className="creator-taste-library-grid">
                  {[
                    ["mutual", "Both have", "Mutual shows"],
                    ["both_completed", "Both completed", "Finished by both"],
                    ["both_watching", "Both watching", "Watching together"],
                    ["only_them", `Only ${displayName}`, "Shows you haven't added"],
                    ["only_me", "Only you", `${displayName} hasn't added`],
                  ].map(([key, label, sub]) => (
                    <button
                      key={key}
                      type="button"
                      className="creator-taste-library-button"
                      onClick={() => loadTasteBrowse(key)}
                    >
                      <strong>{label}</strong>
                      <span>{sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {tasteMatch.genreMatches?.length ? (
                <div className="creator-taste-detail-section">
                  <div className="creator-section-head">
                    <h3>Genre match</h3>
                    <span>Based on genres you have both rated</span>
                  </div>
                  <div className="creator-taste-genre-grid">
                    {tasteMatch.genreMatches.map((genre) => (
                      <div key={genre.genre} className="creator-taste-genre">
                        <strong>{genre.match}%</strong>
                        <span>{genre.genre}</span>
                        <small>
                          You {genre.myAverage}% • {displayName} {genre.theirAverage}%
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteMatch.closestMatches?.length ? (
                <div className="creator-taste-detail-section">
                  <div className="creator-section-head">
                    <h3>Closest matches</h3>
                    <span>Shows you rated almost the same</span>
                  </div>
                  <div className="creator-taste-comparisons creator-taste-comparisons-three">
                    {tasteMatch.closestMatches.map((item) => (
                      <Link
                        key={item.show_id}
                        to={showHref(item.show || { id: item.show_id })}
                        className="creator-taste-comparison"
                      >
                        <span>{item.difference === 0 ? "Exact match" : `${Math.round(item.difference)} points apart`}</span>
                        <strong>{item.show?.name || "Shared show"}</strong>
                        <small>
                          You {Math.round(item.my_rating)}% • {displayName} {Math.round(item.their_rating)}%
                        </small>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteMatch.biggestDisagreements?.length ? (
                <div className="creator-taste-detail-section">
                  <div className="creator-section-head">
                    <h3>Biggest disagreements</h3>
                    <span>Where your scores differ most</span>
                  </div>
                  <div className="creator-taste-comparisons creator-taste-comparisons-three">
                    {tasteMatch.biggestDisagreements.map((item) => (
                      <Link
                        key={item.show_id}
                        to={showHref(item.show || { id: item.show_id })}
                        className="creator-taste-comparison"
                      >
                        <span>{Math.round(item.difference)} points apart</span>
                        <strong>{item.show?.name || "Shared show"}</strong>
                        <small>
                          You {Math.round(item.my_rating)}% • {displayName} {Math.round(item.their_rating)}%
                        </small>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteMatch.sharedFavouriteItems?.length ? (
                <div className="creator-taste-detail-section creator-taste-recommendations">
                  <div className="creator-section-head">
                    <h3>Shared favourites</h3>
                    <span>Shows you both rated 80%+</span>
                  </div>
                  <div className="creator-taste-recommendation-grid">
                    {tasteMatch.sharedFavouriteItems.map((item) => (
                      <Link
                        key={item.show_id}
                        to={showHref(item.show || { id: item.show_id })}
                        className="creator-taste-recommendation"
                      >
                        {item.show?.poster_url ? (
                          <img src={item.show.poster_url} alt="" loading="lazy" />
                        ) : (
                          <span className="creator-taste-poster-fallback">?</span>
                        )}
                        <div>
                          <strong>{item.show?.name || "Show"}</strong>
                          <span>
                            You {Math.round(item.my_rating)}% • {displayName} {Math.round(item.their_rating)}%
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteMatch.recommendationsForMe?.length ? (
                <div className="creator-taste-detail-section creator-taste-recommendations">
                  <div className="creator-section-head">
                    <h3>You should try</h3>
                    <span>{displayName} rated these highly and you haven't rated them</span>
                  </div>
                  <div className="creator-taste-recommendation-grid">
                    {tasteMatch.recommendationsForMe.map((item) => (
                      <Link
                        key={item.show_id}
                        to={showHref(item.show || { id: item.show_id })}
                        className="creator-taste-recommendation"
                      >
                        {item.show?.poster_url ? (
                          <img src={item.show.poster_url} alt="" loading="lazy" />
                        ) : (
                          <span className="creator-taste-poster-fallback">?</span>
                        )}
                        <div>
                          <strong>{item.show?.name || "Show"}</strong>
                          <span>{displayName} rated it {Math.round(item.their_rating)}%</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteMatch.recommendationsForThem?.length ? (
                <div className="creator-taste-detail-section creator-taste-recommendations">
                  <div className="creator-section-head">
                    <h3>{displayName} should try</h3>
                    <span>You rated these highly and they haven't rated them</span>
                  </div>
                  <div className="creator-taste-recommendation-grid">
                    {tasteMatch.recommendationsForThem.map((item) => (
                      <Link
                        key={item.show_id}
                        to={showHref(item.show || { id: item.show_id })}
                        className="creator-taste-recommendation"
                      >
                        {item.show?.poster_url ? (
                          <img src={item.show.poster_url} alt="" loading="lazy" />
                        ) : (
                          <span className="creator-taste-poster-fallback">?</span>
                        )}
                        <div>
                          <strong>{item.show?.name || "Show"}</strong>
                          <span>You rated it {Math.round(item.my_rating)}%</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {tasteScoreIsProvisional ? (
                <p className="creator-taste-note">
                  This is a provisional Taste Match based on your show libraries. Once you have rated at least 3 of the same shows, BURGRS will switch to the stronger ratings + Rank'd score.
                </p>
              ) : displayedTasteScore == null ? (
                <p className="creator-taste-note">
                  Add and rate more shows to build your Taste Match.
                </p>
              ) : null}
            </>
          ) : (
            <p className="creator-muted">Taste Match is unavailable for this profile right now.</p>
          )}
        </section>
      ) : null}

      {tasteBrowseCategory ? (
        <section className="creator-card creator-taste-browser">
          <div className="creator-section-head creator-taste-browser-head">
            <div>
              <h2>
                {tasteBrowseCategory === "total"
                  ? `${displayName}'s shows`
                  : tasteBrowseCategory === "completed"
                  ? `${displayName}'s completed shows`
                  : tasteBrowseCategory === "watching"
                  ? `${displayName} is watching`
                  : tasteBrowseCategory === "airing"
                  ? `${displayName}'s currently airing shows`
                  : tasteBrowseCategory === "mutual"
                  ? "Shows you both have"
                  : tasteBrowseCategory === "both_completed"
                  ? "Shows you both completed"
                  : tasteBrowseCategory === "both_watching"
                  ? "Shows you are both watching"
                  : tasteBrowseCategory === "only_them"
                  ? `Only ${displayName} has these`
                  : "Only you have these"}
              </h2>
              <span>
                {tasteBrowseLoading && !tasteBrowseItems.length
                  ? "Loading..."
                  : `${tasteBrowseTotal.toLocaleString("en-GB")} show${tasteBrowseTotal === 1 ? "" : "s"}`}
              </span>
            </div>
            <button
              type="button"
              className="creator-taste-browser-close"
              onClick={() => {
                setTasteBrowseCategory("");
                setTasteBrowseItems([]);
                setTasteBrowseError("");
                setTasteBrowsePage(0);
                setTasteBrowseHasMore(false);
                setTasteBrowseTotal(0);
              }}
              aria-label="Close show list"
            >
              ×
            </button>
          </div>

          {tasteBrowseError ? (
            <p className="creator-error">{tasteBrowseError}</p>
          ) : null}

          {tasteBrowseItems.length ? (
            <div className="creator-taste-show-grid">
              {tasteBrowseItems.map((show) => (
                <Link
                  key={show.id}
                  to={showHref(show)}
                  className="creator-taste-show-card"
                >
                  {show.poster_url ? (
                    <img src={show.poster_url} alt="" loading="lazy" />
                  ) : (
                    <div className="creator-taste-show-fallback">No poster</div>
                  )}
                  <div>
                    <strong>{show.name || "Untitled show"}</strong>
                    <span>
                      {getShowYear(show)}
                      {show.status ? `${getShowYear(show) ? " • " : ""}${show.status}` : ""}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : tasteBrowseLoading ? (
            <p className="creator-muted">Loading shows...</p>
          ) : !tasteBrowseError ? (
            <p className="creator-muted">No shows in this section.</p>
          ) : null}

          {tasteBrowseHasMore ? (
            <button
              type="button"
              className="creator-btn creator-btn-secondary creator-taste-load-more"
              onClick={() => loadTasteBrowse(tasteBrowseCategory, true)}
              disabled={tasteBrowseLoading}
            >
              {tasteBrowseLoading ? "Loading..." : "Load more shows"}
            </button>
          ) : null}
        </section>
      ) : null}

      {creatorBio ? (
        <section className="creator-card">
          <div className="creator-section-head">
            <h2>About</h2>
          </div>
          <p className="creator-copy">{creatorBio}</p>
        </section>
      ) : null}

      <section
        className={`creator-card creator-profile-panel${activeProfilePanel === "lists" ? " creator-profile-panel-lists" : ""}`}
      >
        {activeProfilePanel === "followers" ? (
          <>
            <div className="creator-section-head">
              <h2>Followers</h2>
            </div>
            <ProfileList profiles={followers} emptyText="No followers yet." />
          </>
        ) : null}

        {activeProfilePanel === "following" ? (
          <>
            <div className="creator-section-head">
              <h2>{isSystemProfile ? "Creators followed" : "Following"}</h2>
            </div>
            <ProfileList
              profiles={following}
              emptyText={isSystemProfile ? "No creator profiles found." : "Not following anyone yet."}
            />
          </>
        ) : null}

        {activeProfilePanel === "lists" ? (
          <>
            <div className="creator-section-head">
              <h2>{isSystemProfile ? "System collection" : "Creator lists"}</h2>
              {isOwnProfile ? (
                <Link to="/creator/lists/new" className="creator-small-link">
                  Create list
                </Link>
              ) : null}
            </div>

            {listCount ? (
              <div className="creator-list-grid">
                {rankedTopShows.length ? (
                  <CreatorListCard
                    listId="rankd-top-10"
                    title="Top 10 shows of all time"
                    subtitle={`${rankedTopShows.length} ranked shows • Auto-updates from Rank'd`}
                    badge="Rank'd"
                    description={`This list is generated from ${displayName}'s current Rank'd ladder and changes whenever their rankings change.`}
                    items={rankedTopShows}
                    isExpanded={expandedListIds.has("rankd-top-10")}
                    onToggle={toggleListExpanded}
                    className="creator-list-card-auto"
                  />
                ) : null}

                {lists.map((list) => {
                  const itemCount = list.items?.length || 0;
                  const subtitle =
                    list.subtitle ||
                    `${itemCount} show${itemCount === 1 ? "" : "s"}${
                      list.visibility === "private" ? " • Private draft" : ""
                    }`;

                  return (
                    <CreatorListCard
                      key={list.id}
                      listId={list.id}
                      title={list.title}
                      subtitle={subtitle}
                      badge={list.badge || formatDate(list.created_at)}
                      description={list.description}
                      items={list.items || []}
                      isExpanded={expandedListIds.has(list.id)}
                      onToggle={toggleListExpanded}
                      canDelete={isOwnProfile}
                      onDelete={handleDeleteList}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="creator-muted">
                {isOwnProfile
                  ? "You have not created any lists yet. Rank shows in Rank'd or tap Create list to make your first one."
                  : "This creator has not shared any lists yet."}
              </p>
            )}
          </>
        ) : null}

        {activeProfilePanel === "posts" ? (
          <>
            <div className="creator-section-head">
              <h2>Creator feed</h2>
              {isOwnProfile ? (
                <Link to="/creator/posts/new" className="creator-small-link">
                  Create post
                </Link>
              ) : null}
            </div>

            {posts.length ? (
              <div className="creator-post-list">
                {posts.map((post) => (
                  <article
                    key={post.id}
                    className={`creator-post-card${post.is_auto_news ? " creator-post-card-news" : ""}`}
                  >
                    <div className="creator-post-meta">
                      <span>{post.is_auto_news ? "TV News" : formatPostType(post.post_type)}</span>
                      <span>{formatDate(post.created_at)}</span>
                      {post.visibility === "subscribers" ? <span>Subscribers only</span> : null}
                    </div>

                    {post.is_auto_news ? (
                      <div className={`creator-news-story${post.image_url ? "" : " no-image"}`}>
                        {post.image_url ? (
                          post.related_show_id ? (
                            <Link to={`/show/${post.related_show_id}`} className="creator-news-poster-link">
                              <img src={post.image_url} alt="" className="creator-news-poster" />
                            </Link>
                          ) : (
                            <img src={post.image_url} alt="" className="creator-news-poster" />
                          )
                        ) : null}
                        <div className="creator-news-copy">
                          {post.source_name ? <span className="creator-news-source">{post.source_name}</span> : null}
                          {post.title ? <h3>{post.title}</h3> : null}
                          <div className="creator-news-actions">
                            {post.related_show_id ? (
                              <Link to={`/show/${post.related_show_id}`} className="creator-news-action creator-news-action-primary">
                                View show
                              </Link>
                            ) : null}
                            {post.source_url ? (
                              <a
                                href={post.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="creator-news-action"
                              >
                                Read source
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <VideoEmbed post={post} />
                        {!post.video_embed_url && post.image_url ? (
                          <img src={post.image_url} alt="" className="creator-post-image" />
                        ) : null}
                        {post.title ? <h3>{post.title}</h3> : null}
                        {post.body ? <p>{post.body}</p> : null}
                      </>
                    )}

                    {isOwnProfile ? (
                      <button
                        type="button"
                        className="creator-delete-post-btn"
                        onClick={() => handleDeletePost(post.id)}
                      >
                        Delete post
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="creator-muted">
                {isOwnProfile
                  ? "You have not posted yet. Tap Create post to share your first update."
                  : "This creator has not posted yet."}
              </p>
            )}
          </>
        ) : null}

        {activeProfilePanel === "reviews" ? (
          <>
            <div className="creator-section-head">
              <h2>Latest reviews</h2>
            </div>

            {reviews.length ? (
              <div className="creator-feed-list">
                {reviews.map((review) => (
                  <article key={review.id} className="creator-review-card">
                    <Link to={showHref(review.shows)} className="creator-review-show">
                      {review.shows?.poster_url ? (
                        <img src={review.shows.poster_url} alt="" />
                      ) : (
                        <div className="creator-review-poster">?</div>
                      )}
                      <div>
                        <strong>{review.shows?.name || "Show review"}</strong>
                        <span>
                          {[formatDate(review.created_at), formatRating(review.user_rating)]
                            .filter(Boolean)
                            .join(" • ")}
                        </span>
                      </div>
                    </Link>
                    <p>{review.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="creator-muted">No public reviews yet.</p>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
