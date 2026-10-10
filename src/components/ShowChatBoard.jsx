import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getProfileDisplayName, getProfileHref } from "../lib/profileLinks";
import { getRootOwnerId, loadBlockedUserIds, usersAreBlocked } from "../lib/userBlocks";
import ReviewVotes from "./ReviewVotes";
import "./ShowChatBoard.css";

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTree(rows) {
  const byId = new Map();
  (rows || []).forEach((row) => byId.set(String(row.id), { ...row, replies: [] }));
  const roots = [];
  byId.forEach((row) => {
    const parentId = row.parent_id ? String(row.parent_id) : "";
    if (parentId && byId.has(parentId)) byId.get(parentId).replies.push(row);
    else roots.push(row);
  });
  return roots;
}

function ChatItem({
  message,
  currentUserId,
  blockedUserIds,
  rootOwnerId,
  onReply,
  savingReplyId,
  onVoteChanged,
  isPinned = false,
  onTogglePin,
  savingPinId,
  depth = 0,
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const profile = message.profile || {};
  const displayName = getProfileDisplayName(
    profile,
    message.user_id ? `User ${String(message.user_id).slice(0, 6)}` : "User"
  );
  const avatarUrl = profile.avatar_url || "";
  const profileUrl = getProfileHref(profile, message.user_id);
  const username = profile.username || "";
  const isSaving = savingReplyId === message.id;
  const isOwnMessage = currentUserId && String(message.user_id) === String(currentUserId);
  const blockedDirectly = blockedUserIds.has(String(message.user_id));
  const blockedRoot = rootOwnerId && blockedUserIds.has(String(rootOwnerId));
  const canReply = Boolean(currentUserId && !isOwnMessage && !blockedDirectly && !blockedRoot);

  useEffect(() => {
    if (!canReply && replyOpen) {
      setReplyOpen(false);
      setReplyBody("");
    }
  }, [canReply, replyOpen]);

  async function submitReply(event) {
    event.preventDefault();
    const trimmed = replyBody.trim();
    if (!trimmed || !canReply) return;
    const ok = await onReply(message.id, trimmed);
    if (ok) {
      setReplyBody("");
      setReplyOpen(false);
    }
  }

  return (
    <article className={`msd-review-item ${depth > 0 ? "is-reply" : "msd-chat-thread"} ${isPinned ? "is-pinned" : ""}`}>
      <div className="msd-review-body-wrap">
        <div className="msd-review-card msd-chat-card">
          <div className="msd-review-head">
            <Link to={profileUrl} className="msd-review-avatar-link" aria-label={`Open ${displayName}'s profile`}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="msd-review-avatar" />
              ) : (
                <div className="msd-review-avatar msd-review-avatar-fallback">
                  {displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
            </Link>
            <div className="msd-review-user-line">
              <Link to={profileUrl} className="msd-review-username">{displayName}</Link>
              {username && displayName !== username ? (
                <Link to={profileUrl} className="msd-review-handle">@{username}</Link>
              ) : null}
            </div>
            <span className="msd-review-date">{formatDateTime(message.created_at)}</span>
          </div>
          {depth === 0 && isPinned ? (
            <div className="msd-chat-pin-marker"><span aria-hidden="true">📌</span> Pinned for you</div>
          ) : null}
          <p className="msd-review-text">{message.body}</p>
        </div>

        <div className="msd-review-actions">
          <ReviewVotes
            tableName="show_chat_message_votes"
            idColumn="message_id"
            itemId={message.id}
            currentUserId={currentUserId}
            upCount={message.up_count || 0}
            downCount={message.down_count || 0}
            myVote={message.my_vote ?? null}
            onChanged={onVoteChanged}
          />
          {canReply ? (
            <button type="button" className="msd-review-action" onClick={() => setReplyOpen((prev) => !prev)}>
              Reply
            </button>
          ) : null}
          {depth === 0 && currentUserId ? (
            <button
              type="button"
              className={`msd-chat-pin-action ${isPinned ? "is-pinned" : ""}`}
              onClick={() => onTogglePin(message.id)}
              disabled={savingPinId === String(message.id)}
              aria-pressed={isPinned}
              aria-label={isPinned ? "Unpin this chat thread" : "Pin this chat thread"}
            >
              <span aria-hidden="true">📌</span>
              {savingPinId === String(message.id) ? "Saving..." : isPinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
        </div>

        {replyOpen && canReply ? (
          <form className="msd-review-reply-form" onSubmit={submitReply}>
            <textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder={`Reply to ${displayName}...`}
              rows={3}
              maxLength={1000}
            />
            <div className="msd-review-form-actions">
              <button type="button" className="msd-btn msd-btn-secondary" onClick={() => { setReplyBody(""); setReplyOpen(false); }}>
                Cancel
              </button>
              <button type="submit" className="msd-btn msd-btn-primary" disabled={isSaving || !replyBody.trim()}>
                {isSaving ? "Sending..." : "Post reply"}
              </button>
            </div>
          </form>
        ) : null}

        {message.replies?.length > 0 ? (
          <div className="msd-review-replies">
            {message.replies.map((reply) => (
              <ChatItem
                key={reply.id}
                message={reply}
                currentUserId={currentUserId}
                blockedUserIds={blockedUserIds}
                rootOwnerId={rootOwnerId}
                onReply={onReply}
                savingReplyId={savingReplyId}
                onVoteChanged={onVoteChanged}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function ShowChatBoard({ showId, currentUserId }) {
  const [messages, setMessages] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState(new Set());
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [pinnedThreadIds, setPinnedThreadIds] = useState(new Set());
  const [chatFilter, setChatFilter] = useState("all");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingReplyId, setSavingReplyId] = useState(null);
  const [savingPinId, setSavingPinId] = useState(null);
  const [error, setError] = useState("");

  async function loadMessages() {
    if (!showId) return;
    setLoading(true);
    setError("");
    try {
      const [messageResult, blockedIds, followingResult] = await Promise.all([
        supabase
          .from("show_chat_messages")
          .select("id, show_id, user_id, parent_id, body, created_at, updated_at")
          .eq("show_id", showId)
          .order("created_at", { ascending: true }),
        loadBlockedUserIds(currentUserId),
        currentUserId
          ? supabase.from("user_follows").select("following_id").eq("follower_id", currentUserId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (messageResult.error) throw messageResult.error;
      if (followingResult.error) throw followingResult.error;
      const rows = messageResult.data || [];
      setBlockedUserIds(blockedIds);
      setFollowingUserIds(new Set((followingResult.data || []).map((row) => String(row.following_id))));

      const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
      let profileMap = new Map();
      if (userIds.length) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, full_name, display_name, avatar_url")
          .in("id", userIds);
        if (profileError) throw profileError;
        profileMap = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
      }

      const messageIds = rows.map((row) => row.id).filter(Boolean);
      let voteMap = new Map();
      let myVoteMap = new Map();
      if (messageIds.length) {
        const { data: voteRows, error: voteError } = await supabase
          .from("show_chat_message_votes")
          .select("message_id, user_id, vote")
          .in("message_id", messageIds);
        if (voteError) throw voteError;
        (voteRows || []).forEach((voteRow) => {
          const key = String(voteRow.message_id);
          const current = voteMap.get(key) || { up: 0, down: 0 };
          if (Number(voteRow.vote) === 1) current.up += 1;
          if (Number(voteRow.vote) === -1) current.down += 1;
          voteMap.set(key, current);
          if (currentUserId && String(voteRow.user_id) === String(currentUserId)) {
            myVoteMap.set(key, Number(voteRow.vote));
          }
        });
      }

      const rootIds = rows.filter((row) => !row.parent_id).map((row) => row.id);
      let pinnedIds = new Set();
      if (currentUserId && rootIds.length) {
        const { data: pinRows, error: pinError } = await supabase
          .from("chat_thread_pins")
          .select("message_id")
          .eq("user_id", currentUserId)
          .in("message_id", rootIds);
        if (pinError) throw pinError;
        pinnedIds = new Set((pinRows || []).map((row) => String(row.message_id)));
      }
      setPinnedThreadIds(pinnedIds);

      setMessages(rows.map((row) => ({
        ...row,
        profile: profileMap.get(String(row.user_id)) || { id: row.user_id },
        up_count: voteMap.get(String(row.id))?.up || 0,
        down_count: voteMap.get(String(row.id))?.down || 0,
        my_vote: myVoteMap.get(String(row.id)) ?? null,
      })));
    } catch (err) {
      console.error("Failed loading chatboard:", err);
      setError(err.message || "Failed loading chatboard");
      setMessages([]);
      setBlockedUserIds(new Set());
      setFollowingUserIds(new Set());
      setPinnedThreadIds(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    if (!showId) return undefined;

    const channel = supabase
      .channel(`show-chat-${showId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "show_chat_messages", filter: `show_id=eq.${showId}` },
        () => loadMessages()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "show_chat_message_votes" },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showId, currentUserId]);

  const messageTree = useMemo(() => buildTree(messages), [messages]);
  const visibleMessageTree = useMemo(() => {
    const matchingThreads = chatFilter === "following"
      ? messageTree.filter((thread) => followingUserIds.has(String(thread.user_id)))
      : messageTree;

    // Keep the existing chronological order within each group.
    return [...matchingThreads].sort((left, right) =>
      Number(pinnedThreadIds.has(String(right.id))) - Number(pinnedThreadIds.has(String(left.id)))
    );
  }, [messageTree, chatFilter, followingUserIds, pinnedThreadIds]);

  async function postMessage(parentId, text) {
    const trimmed = text.trim();
    if (!currentUserId || !showId || !trimmed) return false;
    if (parentId) setSavingReplyId(parentId);
    else setSaving(true);
    setError("");
    try {
      if (parentId) {
        const parentMessage = messages.find((item) => String(item.id) === String(parentId));
        const rootOwnerId = getRootOwnerId(messages, parentId);
        const blocked = await usersAreBlocked(currentUserId, [parentMessage?.user_id, rootOwnerId]);
        if (blocked) {
          setBlockedUserIds(await loadBlockedUserIds(currentUserId));
          setError("You cannot reply because one of you has blocked the other.");
          return false;
        }
      }

      const { error: insertError } = await supabase.from("show_chat_messages").insert({
        show_id: showId,
        user_id: currentUserId,
        parent_id: parentId || null,
        body: trimmed,
      });
      if (insertError) throw insertError;
      await loadMessages();
      return true;
    } catch (err) {
      console.error("Failed posting chat message:", err);
      setError(err.message || "Failed posting chat message");
      return false;
    } finally {
      setSaving(false);
      setSavingReplyId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const ok = await postMessage(null, body);
    if (ok) setBody("");
  }

  async function toggleThreadPin(messageId) {
    if (!currentUserId || !messageId || savingPinId) return;
    const id = String(messageId);
    const isPinned = pinnedThreadIds.has(id);
    setSavingPinId(id);
    setError("");
    try {
      const { error: pinError } = isPinned
        ? await supabase.from("chat_thread_pins").delete()
            .eq("user_id", currentUserId).eq("message_id", messageId)
        : await supabase.from("chat_thread_pins")
            .insert({ user_id: currentUserId, message_id: messageId });
      if (pinError) throw pinError;
      setPinnedThreadIds((previous) => {
        const updated = new Set(previous);
        if (isPinned) updated.delete(id);
        else updated.add(id);
        return updated;
      });
    } catch (pinError) {
      console.error("Failed updating pinned thread:", pinError);
      setError(pinError.message || "Could not update pinned thread.");
    } finally {
      setSavingPinId(null);
    }
  }

  return (
    <section className="msd-reviews-section msd-chatboard-section">
      {currentUserId ? (
        <form className="msd-review-form msd-chat-compose-form" onSubmit={handleSubmit}>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a live chat message..."
            rows={3}
            maxLength={1000}
          />
          <div className="msd-review-form-actions msd-chat-compose-actions">
            <span className="msd-chat-count">{body.trim().length}/1000</span>
            <button type="submit" className="msd-btn msd-btn-primary msd-chat-post-btn" disabled={saving || !body.trim()}>
              {saving ? "Sending..." : "Post chat"}
            </button>
          </div>
        </form>
      ) : (
        <div className="msd-review-login-note">Log in to use the live chatboard.</div>
      )}

      {error ? <div className="msd-review-error">{error}</div> : null}

      <div className="msd-chatboard-filters">
        {currentUserId ? (
          <div className="msd-chatboard-filter-buttons" role="group" aria-label="Filter chat threads">
            <button
              type="button"
              className={`msd-chatboard-filter ${chatFilter === "all" ? "is-active" : ""}`}
              onClick={() => setChatFilter("all")}
              aria-pressed={chatFilter === "all"}
            >
              All
            </button>
            <button
              type="button"
              className={`msd-chatboard-filter ${chatFilter === "following" ? "is-active" : ""}`}
              onClick={() => setChatFilter("following")}
              aria-pressed={chatFilter === "following"}
            >
              Following
            </button>
          </div>
        ) : null}
        {!loading ? (
          <span className="msd-chatboard-thread-count">
            {visibleMessageTree.length} {visibleMessageTree.length === 1 ? "thread" : "threads"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="msd-muted">Loading chatboard...</p>
      ) : visibleMessageTree.length > 0 ? (
        <div className="msd-review-list">
          {visibleMessageTree.map((message) => (
            <ChatItem
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              blockedUserIds={blockedUserIds}
              rootOwnerId={message.user_id}
              onReply={postMessage}
              savingReplyId={savingReplyId}
              onVoteChanged={loadMessages}
              isPinned={pinnedThreadIds.has(String(message.id))}
              onTogglePin={toggleThreadPin}
              savingPinId={savingPinId}
            />
          ))}
        </div>
      ) : (
        <p className="msd-muted">{chatFilter === "following" ? "No threads started by people you follow yet." : "No chat messages yet. Start the conversation."}</p>
      )}
    </section>
  );
}
