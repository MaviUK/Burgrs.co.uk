import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  deleteNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  shouldIgnoreNotificationError,
} from "../lib/notifications";
import "./Notifications.css";

const NOTIFICATIONS_CHANGED_EVENT = "burgrs:notifications-changed";
const NOTIFICATION_PAGE_SIZE = 50;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getProfileName(profile) {
  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    "Someone"
  );
}

function getNotificationTitle(item) {
  const actorName = getProfileName(item.actor_profile);
  const showName = item.show?.name || item.show_name || "this show";

  if (item.type === "review_reply") {
    return `${actorName} replied to ${showName} review`;
  }

  if (item.type === "chat_reply") {
    return `${actorName} replied in ${showName} chatboard`;
  }

  if (item.type === "follow") {
    return `${actorName} started following you`;
  }

  return item.title;
}

function buildShowRoute(show, item) {
  const params = new URLSearchParams({
    notificationType: item.type,
    notificationTarget: item.entity_id,
  });

  if (["new_review", "review_reply"].includes(item.type)) params.set("tab", "reviews");
  if (item.type === "chat_reply") params.set("chat", "1");

  if (show?.tmdb_id) {
    return `/my-shows/tmdb/${show.tmdb_id}?${params.toString()}`;
  }

  if (show?.tvdb_id) {
    return `/my-shows/${show.tvdb_id}?${params.toString()}`;
  }

  return item.url || "/notifications";
}

function isDeletedNotification(item) {
  return Boolean(item?.meta?.deleted_at);
}

async function fetchRowsByIds(table, ids, columns) {
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .in("id", ids);

  if (error) throw error;
  return data || [];
}


async function enrichNotificationRows(notificationRows) {
  if (!notificationRows.length) return [];

  const actorIds = Array.from(
    new Set(notificationRows.map((item) => item.actor_user_id).filter(Boolean))
  );
  const reviewIds = notificationRows
    .filter((item) => ["new_review", "review_reply"].includes(item.type) && item.entity_id)
    .map((item) => item.entity_id);
  const chatIds = notificationRows
    .filter((item) => item.type === "chat_reply" && item.entity_id)
    .map((item) => item.entity_id);

  const [profileRows, reviewRows, chatRows] = await Promise.all([
    fetchRowsByIds(
      "profiles",
      actorIds,
      "id, username, full_name, display_name, avatar_url"
    ),
    fetchRowsByIds("show_reviews", reviewIds, "id, show_id"),
    fetchRowsByIds("show_chat_messages", chatIds, "id, show_id"),
  ]);

  const profileMap = new Map(
    profileRows.map((profile) => [String(profile.id), profile])
  );
  const targetShowMap = new Map();

  reviewRows.forEach((row) => {
    if (row?.id && row?.show_id) {
      targetShowMap.set(String(row.id), row.show_id);
    }
  });

  chatRows.forEach((row) => {
    if (row?.id && row?.show_id) {
      targetShowMap.set(String(row.id), row.show_id);
    }
  });

  const showIds = Array.from(
    new Set(
      notificationRows
        .map(
          (item) =>
            item?.meta?.show_id ||
            targetShowMap.get(String(item.entity_id || "")) ||
            null
        )
        .filter(Boolean)
    )
  );

  const showRows = await fetchRowsByIds(
    "shows",
    showIds,
    "id, name, tvdb_id, tmdb_id, poster_url"
  );
  const showMap = new Map(
    showRows.map((show) => [String(show.id), show])
  );

  return notificationRows.map((item) => {
    const showId =
      item?.meta?.show_id ||
      targetShowMap.get(String(item.entity_id || "")) ||
      null;

    return {
      ...item,
      actor_profile:
        profileMap.get(String(item.actor_user_id || "")) || null,
      show: showId ? showMap.get(String(showId)) || null : null,
    };
  });
}

async function fetchNotificationPage(userId, offset = 0) {
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, recipient_user_id, actor_user_id, type, title, body, url, entity_table, entity_id, meta, read_at, created_at"
    )
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + NOTIFICATION_PAGE_SIZE - 1);

  if (error) throw error;

  const rawRows = data || [];
  const visibleRows = rawRows.filter((item) => !isDeletedNotification(item));
  const enrichedItems = await enrichNotificationRows(visibleRows);

  return {
    items: enrichedItems,
    rawCount: rawRows.length,
    hasMore: rawRows.length === NOTIFICATION_PAGE_SIZE,
  };
}

export default function Notifications() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [tableMissing, setTableMissing] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [markingAllViewed, setMarkingAllViewed] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef(null);

  const unreadIds = useMemo(
    () => items.filter((item) => !item.read_at).map((item) => item.id),
    [items]
  );

  const selectedCount = selectedIds.size;

  function notifyBadgeChanged() {
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
  }

  function startDeleteSelection() {
    setError("");
    setSelectedIds(new Set());
    setSelectionMode(true);
  }

  function cancelDeleteSelection() {
    if (deletingSelected) return;
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function toggleSelected(notificationId) {
    if (!notificationId || deletingSelected) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(notificationId)) next.delete(notificationId);
      else next.add(notificationId);
      return next;
    });
  }

  async function loadNotifications() {
    setLoading(true);
    setError("");
    setTableMissing(false);

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;

      const user = authData?.user || null;
      if (!user?.id) {
        setCurrentUserId(null);
        setItems([]);
        setUnreadCount(0);
        setNextOffset(0);
        setHasMore(false);
        return;
      }

      setCurrentUserId(user.id);

      const [page, nextUnreadCount] = await Promise.all([
        fetchNotificationPage(user.id, 0),
        getUnreadNotificationCount(user.id),
      ]);

      setItems(page.items);
      setUnreadCount(nextUnreadCount);
      setNextOffset(page.rawCount);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("Failed loading notifications:", err);

      if (shouldIgnoreNotificationError(err)) {
        setTableMissing(true);
        setItems([]);
        setUnreadCount(0);
        setHasMore(false);
        return;
      }

      setError(err.message || "Failed loading notifications.");
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreNotifications() {
    if (
      !currentUserId ||
      !hasMore ||
      loading ||
      loadingMore
    ) {
      return;
    }

    setLoadingMore(true);

    try {
      const page = await fetchNotificationPage(currentUserId, nextOffset);

      setItems((current) => {
        const seen = new Set(current.map((item) => String(item.id)));
        return [
          ...current,
          ...page.items.filter((item) => !seen.has(String(item.id))),
        ];
      });
      setNextOffset((current) => current + page.rawCount);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("Failed loading older notifications:", err);
      setError(err.message || "Could not load older notifications.");
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loading || loadingMore) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreNotifications();
        }
      },
      { rootMargin: "320px 0px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [currentUserId, hasMore, loading, loadingMore, nextOffset]);


  async function markAllViewed() {
    if (!currentUserId || !unreadCount || markingAllViewed) return;

    setMarkingAllViewed(true);
    setError("");

    try {
      const now = new Date().toISOString();
      const { error: markError } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("recipient_user_id", currentUserId)
        .is("read_at", null);

      if (markError) throw markError;

      setItems((current) =>
        current.map((item) =>
          item.read_at ? item : { ...item, read_at: now }
        )
      );
      setUnreadCount(0);
      notifyBadgeChanged();
    } catch (err) {
      console.error("Failed marking all notifications viewed:", err);
      setError(err.message || "Could not mark notifications as viewed.");
    } finally {
      setMarkingAllViewed(false);
    }
  }


  async function deleteSelectedNotifications() {
    const ids = Array.from(selectedIds);
    if (!ids.length || deletingSelected) return;

    setDeletingSelected(true);
    setError("");

    try {
      const result = await deleteNotifications(ids);
      if (!result.ok) {
        throw result.error || new Error("Could not delete the selected notifications.");
      }

      const deletedSet = new Set(result.deletedIds || ids);
      setItems((current) =>
        current.filter((item) => !deletedSet.has(item.id))
      );
      setSelectedIds(new Set());
      setSelectionMode(false);
      if (currentUserId) {
        setUnreadCount(await getUnreadNotificationCount(currentUserId));
      }
      notifyBadgeChanged();
    } catch (err) {
      console.error("Failed deleting selected notifications:", err);
      setError(err.message || "Could not delete the selected notifications.");
    } finally {
      setDeletingSelected(false);
    }
  }

  async function resolveNotificationDestination(item) {
    if (
      !item?.entity_id ||
      !["new_review", "review_reply", "chat_reply"].includes(item.type)
    ) {
      return item.url || "/notifications";
    }

    if (item.show) return buildShowRoute(item.show, item);

    const table =
      item.type === "chat_reply" ? "show_chat_messages" : "show_reviews";
    const { data: targetRow, error: targetError } = await supabase
      .from(table)
      .select("id, show_id")
      .eq("id", item.entity_id)
      .maybeSingle();

    if (targetError || !targetRow?.show_id) {
      if (targetError) {
        console.warn("Failed resolving notification target", targetError);
      }
      return item.url || "/notifications";
    }

    const { data: show, error: showError } = await supabase
      .from("shows")
      .select("id, name, tvdb_id, tmdb_id")
      .eq("id", targetRow.show_id)
      .maybeSingle();

    if (showError) {
      console.warn("Failed resolving notification show", showError);
      return item.url || "/notifications";
    }

    return buildShowRoute(show, item);
  }

  async function openNotification(item, event) {
    event.preventDefault();

    if (selectionMode) {
      toggleSelected(item.id);
      return;
    }

    if (openingId || deletingSelected) return;

    setOpeningId(item.id);
    setError("");

    try {
      if (!item.read_at) {
        const result = await markNotificationsRead([item.id]);
        if (result.ok) {
          const now = new Date().toISOString();
          setItems((current) =>
            current.map((currentItem) =>
              currentItem.id === item.id
                ? { ...currentItem, read_at: now }
                : currentItem
            )
          );
          setUnreadCount((count) => Math.max(0, count - 1));
          notifyBadgeChanged();
        }
      }

      const destination = await resolveNotificationDestination(item);
      navigate(destination);
    } catch (err) {
      console.error("Failed opening notification:", err);
      setError(err.message || "Could not open this notification.");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <main className="notifications-page">
      <header className="notifications-header">
        <div>
          <h1>Notifications</h1>
          <p className="notifications-count">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "All caught up"}
          </p>
        </div>

        <div className="notifications-header-actions">
          {!selectionMode && unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAllViewed}
              className="notifications-mark-read"
              disabled={markingAllViewed}
            >
              {markingAllViewed ? "Marking..." : "Mark all as viewed"}
            </button>
          ) : null}

          {!selectionMode && items.length ? (
            <button
              type="button"
              onClick={startDeleteSelection}
              className="notifications-delete-mode"
            >
              Delete
            </button>
          ) : null}

          {selectionMode ? (
            <>
              <button
                type="button"
                onClick={cancelDeleteSelection}
                className="notifications-cancel-delete"
                disabled={deletingSelected}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteSelectedNotifications}
                className="notifications-delete-selected"
                disabled={!selectedCount || deletingSelected}
              >
                {deletingSelected
                  ? "Deleting..."
                  : `Delete selected (${selectedCount})`}
              </button>
            </>
          ) : null}
        </div>
      </header>

      {selectionMode ? (
        <p className="notifications-selection-help">
          Select the notifications you want to delete.
        </p>
      ) : null}

      {error ? <p className="notifications-error">{error}</p> : null}

      {tableMissing ? (
        <section className="notifications-empty">
          <h2>Notifications need setup</h2>
          <p>Run supabase/notifications.sql in Supabase SQL Editor.</p>
        </section>
      ) : loading ? (
        <p className="notifications-muted">Loading notifications...</p>
      ) : items.length ? (
        <>
        <section className="notifications-list">
          {items.map((item) => {
            const actorName = getProfileName(item.actor_profile);
            const avatarUrl = item.actor_profile?.avatar_url || "";
            const usesShowArtwork = [
              "airing_today",
              "new_season",
              "season_premiere_date",
              "for_you_recommendation",
              "tv_news",
              "new_review",
              "show_platform_change",
            ].includes(item.type);
            const thumbnailUrl = usesShowArtwork
              ? item.show?.poster_url || ""
              : avatarUrl;
            const fallbackName = usesShowArtwork
              ? item.show?.name || item.title || "Show"
              : actorName;
            const initial = fallbackName.slice(0, 1).toUpperCase();
            const isSelected = selectedIds.has(item.id);

            return (
              <article
                key={item.id}
                className={`notification-card${
                  item.read_at ? "" : " is-unread"
                }${openingId === item.id ? " is-opening" : ""}${
                  isSelected ? " is-selected" : ""
                }`}
                aria-busy={openingId === item.id || deletingSelected}
              >
                <button
                  type="button"
                  className={`notification-open-button${
                    selectionMode ? " is-selecting" : ""
                  }`}
                  onClick={(event) => openNotification(item, event)}
                  disabled={deletingSelected}
                  aria-pressed={selectionMode ? isSelected : undefined}
                  aria-label={
                    selectionMode
                      ? `${isSelected ? "Unselect" : "Select"} notification: ${getNotificationTitle(item)}`
                      : undefined
                  }
                >
                  {selectionMode ? (
                    <span
                      className={`notification-select-indicator${
                        isSelected ? " is-selected" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                  ) : null}

                  <span
                    className={`notification-icon${usesShowArtwork ? " is-show-artwork" : ""}`}
                    aria-hidden="true"
                  >
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt=""
                        className={usesShowArtwork ? "notification-show-poster" : "notification-avatar"}
                      />
                    ) : (
                      <span className="notification-avatar-fallback">
                        {initial}
                      </span>
                    )}
                  </span>

                  <span className="notification-body">
                    <span className="notification-topline">
                      <strong>{getNotificationTitle(item)}</strong>
                      {!item.read_at ? (
                        <span
                          className="notification-unread-dot"
                          aria-label="Unread"
                        />
                      ) : null}
                    </span>

                    {!["review_reply", "chat_reply"].includes(item.type) &&
                    item.body ? (
                      <span className="notification-message">{item.body}</span>
                    ) : null}

                    <small>{formatDate(item.created_at)}</small>
                  </span>
                </button>
              </article>
            );
          })}
        </section>
        {hasMore || loadingMore ? (
          <div
            ref={loadMoreRef}
            className="notifications-load-more"
            aria-live="polite"
          >
            {loadingMore ? "Loading older notifications..." : "Scroll for older notifications"}
          </div>
        ) : null}
        </>
      ) : (
        <section className="notifications-empty">
          <h2>No notifications yet</h2>
          <p>When people follow you or reply to you, they will appear here.</p>
        </section>
      )}
    </main>
  );
}
