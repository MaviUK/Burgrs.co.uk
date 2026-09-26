import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import FeedComments from "../components/FeedComments";
import { supabase } from "../lib/supabase";
import { getProfileDisplayName, getProfileHref } from "../lib/profileLinks";
import "./FollowingFeed.css";
import "./CreatorListCards.css";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "post", label: "Posts" },
  { key: "list", label: "Lists" },
  { key: "review", label: "Reviews" },
  { key: "chatboard", label: "Chatboards" },
];

const FEED_TIMEOUT_MS = 9000;

function withTimeout(promise, fallback, label = "request") {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Following feed ${label} timed out.`);
      resolve(fallback);
    }, FEED_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatRating(value) {
  const rating = Number(value);
  if (Number.isNaN(rating)) return "";
  return `${Math.round(rating)}%`;
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  const table = String(tableName || "").toLowerCase();

  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes(table) ||
    details.includes(table) ||
    message.includes("schema cache") ||
    details.includes("schema cache")
  );
}

function getRatingKey(userId, showId) {
  return `${String(userId || "")}:${String(showId || "")}`;
}

function getShowYear(show) {
  return String(show?.first_aired || show?.show_year || "").slice(0, 4);
}

function getCreatorName(profile) {
  return getProfileDisplayName(profile, "Someone");
}

function creatorHref(profile, fallbackUserId = null) {
  return getProfileHref(profile, fallbackUserId);
}

function showHref(show) {
  if (!show) return "#";
  if (show.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  return `/show/${show.id || show.show_id}`;
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

function getPosterItems(items, limit = 8) {
  return (items || []).filter((item) => item?.poster_url).slice(0, limit);
}

function getListSubtitle(list) {
  const itemCount = list.items?.length || 0;
  if (list.is_auto_top_list) {
    return `${itemCount} ranked show${itemCount === 1 ? "" : "s"} • Auto-updates from Rank'd`;
  }
  return `${itemCount} show${itemCount === 1 ? "" : "s"}`;
}

function isYouTubeEmbed(url) {
  return Boolean(url && url.includes("youtube.com/embed/"));
}

function isTikTokEmbed(url) {
  return Boolean(url && url.includes("tiktok.com/embed"));
}

function getCommentButtonLabel(type) {
  if (type === "review" || type === "chatboard") return "Replies";
  return "Comments";
}

function VideoEmbed({ post }) {
  const embedUrl = post?.video_embed_url;
  const originalUrl = post?.video_url || embedUrl;

  if (!embedUrl && !originalUrl) return null;

  if (isYouTubeEmbed(embedUrl)) {
    return (
      <div className="following-video following-video-youtube">
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
      <div className="following-video following-video-tiktok">
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
    <a href={originalUrl} target="_blank" rel="noreferrer" className="following-video-link">
      Watch video
    </a>
  );
}

function CreatorLine({ profile, userId, createdAt, activityLabel, comments }) {
  const creator = profile || { id: userId };
  const creatorName = getCreatorName(creator);
  const avatarUrl = creator?.avatar_url || "";
  const profileHref = creatorHref(creator, userId);

  return (
    <div className="following-creator-line">
      <Link to={profileHref} className="following-avatar-link">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="following-avatar" />
        ) : (
          <div className="following-avatar following-avatar-fallback">
            {creatorName.slice(0, 1).toUpperCase()}
          </div>
        )}
      </Link>
      <div className="following-creator-copy">
        <Link to={profileHref} className="following-creator-name-link">
          <strong>{creatorName}</strong>
        </Link>
        <div className="following-creator-meta-row">
          <div className="following-meta-left">
            {activityLabel ? <span className="following-meta-type">{activityLabel}</span> : null}
            {activityLabel ? <span className="following-meta-dot">·</span> : null}
            <span>{formatDate(createdAt)}</span>
          </div>
          <div className="following-meta-comments">{comments}</div>
        </div>
      </div>
    </div>
  );
}

function FollowingListCard({ list, isExpanded, onToggle }) {
  const posterItems = getPosterItems(list.items);
  const badge = list.is_auto_top_list ? "Rank'd" : formatDate(list.created_at);
  const title = list.title || "Untitled list";
  const subtitle = getListSubtitle(list);

  return (
    <div className={`creator-list-card creator-list-card-collapsed following-profile-list-card ${isExpanded ? "is-expanded" : ""}`.trim()}>
      <button
        type="button"
        className="creator-list-cover-button"
        onClick={() => onToggle(list.id)}
        aria-expanded={isExpanded}
      >
        <div className="creator-list-cover-art" aria-hidden="true">
          {posterItems.length ? (
            <div className="creator-list-poster-collage">
              {posterItems.map((item, index) => (
                <img
                  key={`${list.id}-poster-${item.show_id || item.id || index}`}
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
          {list.description ? <p className="creator-list-description">{list.description}</p> : null}

          {list.items?.length ? (
            <div className="creator-list-items">
              {list.items.map((item) => (
                <Link key={item.id} to={showHref(item)} className="creator-list-item">
                  <span className="creator-rank">#{item.rank}</span>
                  {item.poster_url ? <img src={item.poster_url} alt="" /> : <span className="creator-mini-poster">?</span>}
                  <span>
                    <strong>{item.show_name}</strong>
                    {item.show_year ? <small>{item.show_year}</small> : null}
                    {item.note ? <em>{item.note}</em> : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="following-muted">No shows added yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

async function fetchCreatorLists(followingIds) {
  if (!followingIds.length) return [];

  try {
    const result = await withTimeout(
      supabase
        .from("creator_lists")
        .select("id, user_id, title, description, list_type, visibility, created_at, updated_at")
        .in("user_id", followingIds)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(40),
      { data: [], error: null },
      "creator lists"
    );

    if (result.error) {
      if (isMissingTableError(result.error, "creator_lists")) return [];
      console.warn("Following creator lists fetch error:", result.error);
      return [];
    }

    const rows = result.data || [];
    if (!rows.length) return [];

    const listIds = rows.map((list) => list.id).filter(Boolean);
    const itemsResult = await withTimeout(
      supabase
        .from("creator_list_items")
        .select("id, list_id, rank, show_id, show_name, show_year, poster_url, tmdb_id, note")
        .in("list_id", listIds)
        .order("rank", { ascending: true }),
      { data: [], error: null },
      "creator list items"
    );

    if (itemsResult.error) {
      console.warn("Following creator list items fetch error:", itemsResult.error);
      return rows.map((list) => ({ ...list, items: [] }));
    }

    const itemsByListId = new Map();
    (itemsResult.data || []).forEach((item) => {
      const key = String(item.list_id);
      const currentItems = itemsByListId.get(key) || [];
      currentItems.push(item);
      itemsByListId.set(key, currentItems);
    });

    return rows.map((list) => ({
      ...list,
      items: itemsByListId.get(String(list.id)) || [],
    }));
  } catch (error) {
    console.warn("Following creator lists failed:", error);
    return [];
  }
}

async function fetchAutomaticRankdLists(followingIds) {
  if (!followingIds.length) return [];

  try {
    const rankingResult = await withTimeout(
      supabase
        .from("user_show_rankings")
        .select("user_id, show_id, ladder_position, comparisons, updated_at")
        .in("user_id", followingIds)
        .order("user_id", { ascending: true })
        .order("ladder_position", { ascending: true, nullsFirst: false })
        .limit(1000),
      { data: [], error: null },
      "automatic Rankd lists"
    );

    if (rankingResult.error) {
      if (isMissingTableError(rankingResult.error, "user_show_rankings")) return [];
      console.warn("Following automatic Rankd list fetch error:", rankingResult.error);
      return [];
    }

    const rankingRows = rankingResult.data || [];
    if (!rankingRows.length) return [];

    const rowsByUserId = new Map();
    rankingRows.forEach((row) => {
      const userId = String(row.user_id || "");
      if (!userId || !row.show_id) return;
      const current = rowsByUserId.get(userId) || [];
      if (current.length < 10) {
        current.push(row);
        rowsByUserId.set(userId, current);
      }
    });

    const showIds = Array.from(new Set(rankingRows.map((row) => row.show_id).filter(Boolean)));
    if (!showIds.length) return [];

    const showsResult = await withTimeout(
      supabase
        .from("shows")
        .select("id, name, tmdb_id, first_aired, poster_url")
        .in("id", showIds),
      { data: [], error: null },
      "automatic Rankd list shows"
    );

    if (showsResult.error) {
      console.warn("Following automatic Rankd show fetch error:", showsResult.error);
      return [];
    }

    const showMap = new Map((showsResult.data || []).map((show) => [String(show.id), show]));

    return Array.from(rowsByUserId.entries())
      .map(([userId, rows]) => {
        const items = rows
          .map((row, index) => {
            const show = showMap.get(String(row.show_id));
            if (!show) return null;

            return {
              id: `rankd-auto-${userId}-${row.show_id}`,
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
          .filter(Boolean);

        if (!items.length) return null;

        const latest = rows.map((row) => row.updated_at).filter(Boolean).sort().at(-1);

        return {
          id: `rankd-top-10-${userId}`,
          user_id: userId,
          title: "Top 10 shows of all time",
          description: "This list is generated from this creator's current Rank'd ladder and changes whenever their rankings change.",
          list_type: "automatic_top_10",
          visibility: "public",
          created_at: latest || new Date(0).toISOString(),
          updated_at: latest || null,
          is_auto_top_list: true,
          items,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn("Following automatic Rankd lists failed:", error);
    return [];
  }
}

async function fetchReviewRatings(reviewRows) {
  const reviews = reviewRows || [];
  const ratingUserIds = Array.from(new Set(reviews.map((review) => review.user_id).filter(Boolean)));
  const ratingShowIds = Array.from(new Set(reviews.map((review) => review.show_id).filter(Boolean)));

  if (!ratingUserIds.length || !ratingShowIds.length) return new Map();

  try {
    const result = await withTimeout(
      supabase
        .from("burgr_ratings")
        .select("user_id, show_id, rating")
        .in("user_id", ratingUserIds)
        .in("show_id", ratingShowIds),
      { data: [], error: null },
      "review ratings"
    );

    if (result.error) {
      if (isMissingTableError(result.error, "burgr_ratings")) return new Map();
      console.warn("Following review ratings fetch error:", result.error);
      return new Map();
    }

    return new Map((result.data || []).map((row) => [getRatingKey(row.user_id, row.show_id), row.rating]));
  } catch (error) {
    console.warn("Following review ratings failed:", error);
    return new Map();
  }
}

export default function FollowingFeed() {
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [currentUserId, setCurrentUserId] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [posts, setPosts] = useState([]);
  const [lists, setLists] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [expandedListIds, setExpandedListIds] = useState(() => new Set());
  const [openCommentIds, setOpenCommentIds] = useState(() => new Set());
  const [error, setError] = useState("");

  const feedItems = useMemo(() => {
    return [
      ...posts.map((post) => ({ type: "post", created_at: post.created_at, data: post })),
      ...lists.map((list) => ({ type: "list", created_at: list.updated_at || list.created_at, data: list })),
      ...reviews.map((review) => ({ type: "review", created_at: review.created_at, data: review })),
      ...chatMessages.map((message) => ({ type: "chatboard", created_at: message.created_at, data: message })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [posts, lists, reviews, chatMessages]);

  const filteredFeedItems = useMemo(() => {
    if (activeFilter === "all") return feedItems;
    return feedItems.filter((item) => item.type === activeFilter);
  }, [activeFilter, feedItems]);

  function toggleListExpanded(listId) {
    setExpandedListIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  function setCommentsOpen(commentKey, isOpen) {
    setOpenCommentIds((current) => {
      const next = new Set(current);
      if (isOpen) next.add(commentKey);
      else next.delete(commentKey);
      return next;
    });
  }

  function toggleComments(commentKey) {
    setOpenCommentIds((current) => {
      const next = new Set(current);
      if (next.has(commentKey)) next.delete(commentKey);
      else next.add(commentKey);
      return next;
    });
  }

  function isCommentsOpen(commentKey) {
    return openCommentIds.has(commentKey);
  }

  function renderCommentButton(commentKey, type) {
    const isOpen = isCommentsOpen(commentKey);
    return (
      <button
        type="button"
        className="feed-comments-inline-toggle following-header-comment-button"
        onClick={() => toggleComments(commentKey)}
        aria-expanded={isOpen}
      >
        <span>{getCommentButtonLabel(type)}</span>
        <em>{isOpen ? "⌃" : "⌄"}</em>
      </button>
    );
  }

  async function loadFeed() {
    setLoading(true);
    setError("");

    try {
      const authResult = await withTimeout(
        supabase.auth.getUser(),
        { data: { user: null }, error: null },
        "auth"
      );
      const user = authResult?.data?.user || null;
      setCurrentUserId(user?.id || null);

      if (!user?.id) {
        setReviews([]);
        setPosts([]);
        setLists([]);
        setChatMessages([]);
        return;
      }

      const followsResult = await withTimeout(
        supabase
          .from("user_follows")
          .select("following_id")
          .eq("follower_id", user.id),
        { data: [], error: null },
        "follows"
      );

      if (followsResult.error) throw followsResult.error;

      const followingIds = (followsResult.data || [])
        .map((row) => row.following_id)
        .filter(Boolean);

      if (!followingIds.length) {
        setReviews([]);
        setPosts([]);
        setLists([]);
        setChatMessages([]);
        return;
      }

      const [postsResult, listRows, autoRankdLists, reviewsResult, chatResult] = await Promise.all([
        withTimeout(
          supabase
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
            .in("user_id", followingIds)
            .eq("visibility", "public")
            .order("created_at", { ascending: false })
            .limit(40),
          { data: [], error: null },
          "creator posts"
        ),
        fetchCreatorLists(followingIds),
        fetchAutomaticRankdLists(followingIds),
        withTimeout(
          supabase
            .from("show_reviews")
            .select("id, user_id, show_id, body, created_at")
            .in("user_id", followingIds)
            .is("parent_id", null)
            .order("created_at", { ascending: false })
            .limit(40),
          { data: [], error: null },
          "reviews"
        ),
        withTimeout(
          supabase
            .from("show_chat_messages")
            .select("id, show_id, user_id, parent_id, body, created_at, updated_at")
            .in("user_id", followingIds)
            .is("parent_id", null)
            .order("created_at", { ascending: false })
            .limit(40),
          { data: [], error: null },
          "chatboards"
        ),
      ]);

      if (postsResult.error) throw postsResult.error;
      if (reviewsResult.error) throw reviewsResult.error;
      if (chatResult.error) throw chatResult.error;

      const postRows = postsResult.data || [];
      const reviewRows = reviewsResult.data || [];
      const chatRows = chatResult.data || [];
      const allListRows = [...(autoRankdLists || []), ...(listRows || [])];
      const ratingMap = await fetchReviewRatings(reviewRows);

      const allUserIds = Array.from(
        new Set([
          ...postRows.map((post) => post.user_id),
          ...allListRows.map((list) => list.user_id),
          ...reviewRows.map((review) => review.user_id),
          ...chatRows.map((message) => message.user_id),
        ].filter(Boolean))
      );

      let profileMap = new Map();

      if (allUserIds.length) {
        const profilesResult = await withTimeout(
          supabase
            .from("profiles")
            .select("id, username, full_name, display_name, avatar_url")
            .in("id", allUserIds),
          { data: [], error: null },
          "profiles"
        );

        if (profilesResult.error) throw profilesResult.error;
        profileMap = new Map((profilesResult.data || []).map((profile) => [String(profile.id), profile]));
      }

      const showIds = Array.from(
        new Set([
          ...reviewRows.map((review) => review.show_id),
          ...chatRows.map((message) => message.show_id),
        ].filter(Boolean))
      );

      let showMap = new Map();

      if (showIds.length) {
        const showsResult = await withTimeout(
          supabase
            .from("shows")
            .select("id, name, tmdb_id, first_aired, poster_url, backdrop_url")
            .in("id", showIds),
          { data: [], error: null },
          "shows"
        );

        if (showsResult.error) throw showsResult.error;
        showMap = new Map((showsResult.data || []).map((show) => [String(show.id), show]));
      }

      setPosts(
        postRows.map((post) => ({
          ...post,
          profiles: profileMap.get(String(post.user_id)) || { id: post.user_id },
        }))
      );

      setLists(
        allListRows.map((list) => ({
          ...list,
          profiles: profileMap.get(String(list.user_id)) || { id: list.user_id },
          items: list.items || [],
        }))
      );

      setReviews(
        reviewRows.map((review) => ({
          ...review,
          user_rating: ratingMap.get(getRatingKey(review.user_id, review.show_id)) ?? null,
          profiles: profileMap.get(String(review.user_id)) || { id: review.user_id },
          shows: showMap.get(String(review.show_id)) || null,
        }))
      );

      setChatMessages(
        chatRows.map((message) => ({
          ...message,
          profiles: profileMap.get(String(message.user_id)) || { id: message.user_id },
          shows: showMap.get(String(message.show_id)) || null,
        }))
      );
    } catch (err) {
      console.error("Failed loading following feed:", err);
      setError(err.message || "Failed loading feed.");
      setReviews([]);
      setPosts([]);
      setLists([]);
      setChatMessages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeed();
  }, []);

  const activeFilterLabel = FILTERS.find((filter) => filter.key === activeFilter)?.label || "items";

  return (
    <main className="following-page">
      <div className="following-filter-row" aria-label="Filter following feed">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={`following-filter-chip${activeFilter === filter.key ? " is-active" : ""}`}
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? <p className="following-error">{error}</p> : null}

      {loading ? (
        <p className="following-muted">Loading feed...</p>
      ) : filteredFeedItems.length ? (
        <section className="following-feed-list">
          {filteredFeedItems.map((item) => {
            if (item.type === "post") {
              const post = item.data;
              const commentKey = `post-${post.id}`;

              return (
                <article
                  key={`post-${post.id}`}
                  className={`following-card${post.is_auto_news ? " following-card-news" : ""}`}
                >
                  <CreatorLine
                    profile={post.profiles}
                    userId={post.user_id}
                    createdAt={post.created_at}
                    activityLabel={post.is_auto_news ? "TV News" : formatPostType(post.post_type)}
                    comments={renderCommentButton(commentKey, "post")}
                  />

                  {post.is_auto_news ? (
                    <div className={`following-news-story${post.image_url ? "" : " no-image"}`}>
                      {post.image_url ? (
                        post.related_show_id ? (
                          <Link to={`/show/${post.related_show_id}`} className="following-news-poster-link">
                            <img src={post.image_url} alt="" className="following-news-poster" />
                          </Link>
                        ) : (
                          <img src={post.image_url} alt="" className="following-news-poster" />
                        )
                      ) : null}

                      <div className="following-news-copy">
                        <div className="following-news-kicker">
                          <span>Latest</span>
                          {post.source_name ? <em>{post.source_name}</em> : null}
                        </div>
                        {post.title ? <h2 className="following-news-title">{post.title}</h2> : null}
                        <div className="following-news-actions">
                          {post.related_show_id ? (
                            <Link to={`/show/${post.related_show_id}`} className="following-news-action following-news-action-primary">
                              View show
                            </Link>
                          ) : null}
                          {post.source_url ? (
                            <a
                              href={post.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="following-news-action"
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
                        <img src={post.image_url} alt="" className="following-post-image" />
                      ) : null}
                      {post.title ? <h2 className="following-post-title">{post.title}</h2> : null}
                      {post.body ? <p className="following-review-text">{post.body}</p> : null}
                    </>
                  )}

                  <FeedComments
                    inline
                    hideToggle
                    isOpen={isCommentsOpen(commentKey)}
                    onOpenChange={(value) => setCommentsOpen(commentKey, value)}
                    targetType="post"
                    targetId={post.id}
                    currentUserId={currentUserId}
                  />
                </article>
              );
            }

            if (item.type === "list") {
              const list = item.data;
              const listKey = String(list.id);
              const commentKey = `list-${list.id}`;

              return (
                <article key={`list-${list.id}`} className="following-card following-card-list">
                  <CreatorLine
                    profile={list.profiles}
                    userId={list.user_id}
                    createdAt={list.updated_at || list.created_at}
                    activityLabel={list.is_auto_top_list ? "Rank'd Top 10" : "List"}
                    comments={renderCommentButton(commentKey, "list")}
                  />
                  <FollowingListCard
                    list={list}
                    isExpanded={expandedListIds.has(listKey)}
                    onToggle={toggleListExpanded}
                  />
                  <FeedComments
                    inline
                    hideToggle
                    isOpen={isCommentsOpen(commentKey)}
                    onOpenChange={(value) => setCommentsOpen(commentKey, value)}
                    targetType="list"
                    targetId={list.id}
                    currentUserId={currentUserId}
                  />
                </article>
              );
            }

            if (item.type === "chatboard") {
              const message = item.data;
              const show = message.shows;
              const commentKey = `chatboard-${message.id}`;

              return (
                <article key={`chatboard-${message.id}`} className="following-card">
                  <CreatorLine
                    profile={message.profiles}
                    userId={message.user_id}
                    createdAt={message.created_at}
                    activityLabel="Chatboard"
                    comments={renderCommentButton(commentKey, "chatboard")}
                  />
                  <Link to={showHref(show)} className="following-show-card">
                    {show?.poster_url ? <img src={show.poster_url} alt="" /> : <div className="following-poster-fallback">?</div>}
                    <div>
                      <strong>{show?.name || "Show chatboard"}</strong>
                      {show?.first_aired ? <span>{String(show.first_aired).slice(0, 4)}</span> : null}
                    </div>
                  </Link>
                  <p className="following-review-text">{message.body}</p>
                  <FeedComments
                    inline
                    hideToggle
                    isOpen={isCommentsOpen(commentKey)}
                    onOpenChange={(value) => setCommentsOpen(commentKey, value)}
                    targetType="chatboard"
                    targetId={message.id}
                    currentUserId={currentUserId}
                  />
                </article>
              );
            }

            const review = item.data;
            const show = review.shows;
            const ratingLabel = formatRating(review.user_rating);
            const commentKey = `review-${review.id}`;

            return (
              <article key={`review-${review.id}`} className="following-card">
                <CreatorLine
                  profile={review.profiles}
                  userId={review.user_id}
                  createdAt={review.created_at}
                  activityLabel="Review"
                  comments={renderCommentButton(commentKey, "review")}
                />
                <Link to={showHref(show)} className="following-show-card">
                  {show?.poster_url ? <img src={show.poster_url} alt="" /> : <div className="following-poster-fallback">?</div>}
                  <div>
                    <div className="following-show-title-row">
                      <strong>{show?.name || "Untitled show"}</strong>
                      {ratingLabel ? <span className="following-rating-pill">{ratingLabel}</span> : null}
                    </div>
                    {show?.first_aired ? <span>{String(show.first_aired).slice(0, 4)}</span> : null}
                  </div>
                </Link>
                <p className="following-review-text">{review.body}</p>
                <FeedComments
                  inline
                  hideToggle
                  isOpen={isCommentsOpen(commentKey)}
                  onOpenChange={(value) => setCommentsOpen(commentKey, value)}
                  targetType="review"
                  targetId={review.id}
                  currentUserId={currentUserId}
                />
              </article>
            );
          })}
        </section>
      ) : feedItems.length ? (
        <section className="following-empty">
          <h2>No {activeFilterLabel.toLowerCase()} yet</h2>
          <p>The creators you follow have not shared this type of activity yet.</p>
        </section>
      ) : (
        <section className="following-empty">
          <h2>No creator activity yet</h2>
          <p>
            Follow creators to build your free feed. Their posts, lists, reviews
            and chatboards will appear here.
          </p>
          <Link to="/search" className="following-empty-btn">
            Find shows and reviewers
          </Link>
        </section>
      )}
    </main>
  );
}
