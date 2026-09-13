import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getProfileDisplayName, getProfileHref } from "../lib/profileLinks";
import { getRootOwnerId, loadBlockedUserIds, usersAreBlocked } from "../lib/userBlocks";
import ReviewVotes from "./ReviewVotes";

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRating(value) {
  const rating = Number(value);
  if (Number.isNaN(rating)) return "";
  return `${Math.round(rating)}%`;
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

function countAllReplies(review) {
  if (!Array.isArray(review?.replies) || review.replies.length === 0) return 0;
  return review.replies.reduce((total, reply) => total + 1 + countAllReplies(reply), 0);
}

function ReviewItem({
  review,
  config,
  currentUserId,
  blockedUserIds,
  rootOwnerId,
  onReply,
  onEdit,
  onDelete,
  savingReplyId,
  savingEditId,
  deletingId,
  onVoteChanged,
  depth = 0,
  forceShowReplies = false,
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(review.body || "");
  const [showReplies, setShowReplies] = useState(false);
  const [showFullText, setShowFullText] = useState(false);

  const profile = review.profile || {};
  const displayName = getProfileDisplayName(profile, "User");
  const avatarUrl = profile.avatar_url || "";
  const username = profile.username || "";
  const profileUrl = getProfileHref(profile, review.user_id);
  const ratingLabel = formatRating(review.user_rating);
  const isOwnReview = currentUserId && String(review.user_id) === String(currentUserId);
  const canModerateReply = Boolean(
    depth > 0 &&
    currentUserId &&
    rootOwnerId &&
    String(rootOwnerId) === String(currentUserId) &&
    !isOwnReview
  );
  const blockedDirectly = blockedUserIds.has(String(review.user_id));
  const blockedRoot = rootOwnerId && blockedUserIds.has(String(rootOwnerId));
  const canReply = Boolean(currentUserId && !isOwnReview && !blockedDirectly && !blockedRoot);
  const hasReplies = Array.isArray(review.replies) && review.replies.length > 0;
  const allRepliesCount = countAllReplies(review);
  const effectiveShowReplies = forceShowReplies || showReplies;
  const isSavingReply = savingReplyId === review.id;
  const isSavingEdit = savingEditId === review.id;
  const isDeleting = deletingId === review.id;
  const hasLongText = String(review.body || "").trim().length > 220;

  useEffect(() => {
    setShowFullText(false);
  }, [review.id, review.body]);

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
    const ok = await onReply(review.id, trimmed);
    if (ok) {
      setReplyBody("");
      setReplyOpen(false);
      setShowReplies(true);
    }
  }

  async function submitEdit(event) {
    event.preventDefault();
    const trimmed = editBody.trim();
    if (!trimmed || !isOwnReview) return;
    const ok = await onEdit(review.id, trimmed, { appendOnly: hasReplies });
    if (ok) {
      setEditBody(hasReplies ? "" : trimmed);
      setEditing(false);
    }
  }

  async function deleteReview() {
    const ok = await onDelete(review.id);
    if (ok) setEditing(false);
  }

  return (
    <article className={`msd-review-item ${depth > 0 ? "is-reply" : ""}`}>
      <div className="msd-review-body-wrap">
        <div className="msd-review-card">
          <div className="msd-review-head">
            <div className="msd-review-head-left">
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
                {ratingLabel ? <span className="msd-review-rating">{ratingLabel}</span> : null}
                {username && displayName !== username ? (
                  <Link to={profileUrl} className="msd-review-handle">@{username}</Link>
                ) : null}
                <span className="msd-review-date">{formatDateTime(review.created_at)}</span>
              </div>
            </div>

            {isOwnReview ? (
              <button
                type="button"
                className="msd-review-header-action"
                onClick={() => {
                  setEditBody(hasReplies ? "" : review.body || "");
                  setEditing((prev) => !prev);
                }}
              >
                Edit
              </button>
            ) : canModerateReply ? (
              <button
                type="button"
                className="msd-review-header-action"
                onClick={deleteReview}
                disabled={isDeleting}
                aria-label="Delete reply to your review"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </div>

          {editing ? (
            <form className="msd-review-reply-form" onSubmit={submitEdit}>
              {hasReplies ? (
                <div className="msd-review-edit-note">
                  This has replies, so editing adds an update. Deleting removes your post and leaves other users' replies as separate posts.
                </div>
              ) : null}

              <textarea
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
                rows={4}
                maxLength={2000}
                placeholder={hasReplies ? "Add an update..." : "Edit your review..."}
              />

              <div className="msd-review-form-actions">
                <button
                  type="button"
                  className="msd-btn msd-btn-danger"
                  onClick={deleteReview}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>

                <div className="msd-review-form-buttons">
                  <button
                    type="button"
                    className="msd-btn msd-btn-secondary"
                    onClick={() => {
                      setEditBody(hasReplies ? "" : review.body || "");
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="msd-btn msd-btn-primary"
                    disabled={isSavingEdit || !editBody.trim()}
                  >
                    {isSavingEdit ? "Saving..." : hasReplies ? "Add update" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <>
              <p
                className="msd-review-text"
                style={
                  hasLongText && !showFullText
                    ? {
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 4,
                        overflow: "hidden",
                      }
                    : undefined
                }
              >
                {review.body}
              </p>
              {hasLongText ? (
                <button
                  type="button"
                  onClick={() => setShowFullText((visible) => !visible)}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "#f8fafc",
                    padding: "4px 0 0",
                    font: "inherit",
                    fontSize: "0.9rem",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {showFullText ? "Show less" : "View all"}
                </button>
              ) : null}
            </>
          )}

          <div className="msd-review-card-votes">
            <ReviewVotes
              tableName={config.voteTable}
              idColumn={config.voteIdColumn}
              itemId={review.id}
              currentUserId={currentUserId}
              upCount={review.up_count || 0}
              downCount={review.down_count || 0}
              myVote={review.my_vote ?? null}
              onChanged={(nextVote, previousVote) =>
                onVoteChanged(review.id, nextVote, previousVote)
              }
            />
          </div>
        </div>

        <div className="msd-review-actions">
          {hasReplies && !forceShowReplies ? (
            <button
              type="button"
              className="msd-review-action msd-review-replies-toggle"
              onClick={() => setShowReplies((prev) => !prev)}
            >
              {showReplies
                ? `Hide ${allRepliesCount} ${allRepliesCount === 1 ? "reply" : "replies"}`
                : `View ${allRepliesCount} ${allRepliesCount === 1 ? "reply" : "replies"}`}
            </button>
          ) : null}

          <div className="msd-review-action-right">
            {canReply ? (
              <button
                type="button"
                className="msd-review-action msd-review-reply-action"
                onClick={() => setReplyOpen((prev) => !prev)}
              >
                Reply
              </button>
            ) : null}
          </div>
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
              <span className="msd-review-char-count">{replyBody.trim().length}/1000</span>
              <div className="msd-review-form-buttons">
                <button
                  type="button"
                  className="msd-btn msd-btn-secondary"
                  onClick={() => {
                    setReplyBody("");
                    setReplyOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="msd-btn msd-btn-primary"
                  disabled={isSavingReply || !replyBody.trim()}
                >
                  {isSavingReply ? "Saving..." : "Post reply"}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {hasReplies && effectiveShowReplies ? (
          <div className="msd-review-replies">
            {review.replies.map((reply) => (
              <ReviewItem
                key={reply.id}
                review={reply}
                config={config}
                currentUserId={currentUserId}
                blockedUserIds={blockedUserIds}
                rootOwnerId={rootOwnerId}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                savingReplyId={savingReplyId}
                savingEditId={savingEditId}
                deletingId={deletingId}
                onVoteChanged={onVoteChanged}
                depth={depth + 1}
                forceShowReplies={effectiveShowReplies}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function ReviewThread({ config, itemId, currentUserId, heading, subheading }) {
  const [reviews, setReviews] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingReplyId, setSavingReplyId] = useState(null);
  const [savingEditId, setSavingEditId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  async function loadReviews() {
    if (!itemId) return;
    setLoading(true);
    setError("");

    try {
      const [reviewResult, blockedIds] = await Promise.all([
        supabase
          .from(config.reviewTable)
          .select(`id, ${config.itemColumn}, user_id, parent_id, body, created_at, updated_at`)
          .eq(config.itemColumn, itemId)
          .order("created_at", { ascending: true }),
        loadBlockedUserIds(currentUserId),
      ]);

      if (reviewResult.error) throw reviewResult.error;
      const reviewRows = reviewResult.data || [];
      setBlockedUserIds(blockedIds);

      const userIds = Array.from(new Set(reviewRows.map((row) => row.user_id).filter(Boolean)));
      let profileMap = new Map();
      if (userIds.length) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, full_name, display_name, avatar_url")
          .in("id", userIds);
        if (profileError) throw profileError;
        profileMap = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
      }

      let ratingMap = new Map();
      if (userIds.length && config.ratingTable) {
        const { data: ratingRows, error: ratingError } = await supabase
          .from(config.ratingTable)
          .select(`user_id, ${config.itemColumn}, rating`)
          .eq(config.itemColumn, itemId)
          .in("user_id", userIds);
        if (ratingError) throw ratingError;
        ratingMap = new Map((ratingRows || []).map((rating) => [String(rating.user_id), rating.rating]));
      }

      const reviewIds = reviewRows.map((row) => row.id).filter(Boolean);
      let voteMap = new Map();
      let myVoteMap = new Map();
      if (reviewIds.length) {
        const { data: voteRows, error: voteError } = await supabase
          .from(config.voteTable)
          .select(`${config.voteIdColumn}, user_id, vote`)
          .in(config.voteIdColumn, reviewIds);
        if (voteError) throw voteError;
        (voteRows || []).forEach((voteRow) => {
          const key = String(voteRow[config.voteIdColumn]);
          const current = voteMap.get(key) || { up: 0, down: 0 };
          if (Number(voteRow.vote) === 1) current.up += 1;
          if (Number(voteRow.vote) === -1) current.down += 1;
          voteMap.set(key, current);
          if (currentUserId && String(voteRow.user_id) === String(currentUserId)) {
            myVoteMap.set(key, Number(voteRow.vote));
          }
        });
      }

      setReviews(
        reviewRows.map((row) => ({
          ...row,
          profile: profileMap.get(String(row.user_id)) || { id: row.user_id },
          user_rating: ratingMap.get(String(row.user_id)) ?? null,
          up_count: voteMap.get(String(row.id))?.up || 0,
          down_count: voteMap.get(String(row.id))?.down || 0,
          my_vote: myVoteMap.get(String(row.id)) ?? null,
        }))
      );
    } catch (err) {
      console.error("Failed loading reviews:", err);
      setError(err.message || "Failed loading reviews");
      setReviews([]);
      setBlockedUserIds(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setBody("");
    loadReviews();
  }, [itemId, currentUserId]);

  const reviewTree = useMemo(() => buildTree(reviews), [reviews]);
  const hasPostedRootReview = useMemo(
    () => reviews.some((item) => !item.parent_id && String(item.user_id) === String(currentUserId)),
    [reviews, currentUserId]
  );

  async function handleSubmitReview(event) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!currentUserId || !itemId || !trimmed || saving || hasPostedRootReview) return;
    setSaving(true);
    setError("");
    try {
      const { error: insertError } = await supabase.from(config.reviewTable).insert({
        [config.itemColumn]: itemId,
        user_id: currentUserId,
        parent_id: null,
        body: trimmed,
      });
      if (insertError) throw insertError;
      setBody("");
      await loadReviews();
    } catch (err) {
      console.error("Failed posting review:", err);
      setError(err.message || "Failed posting review");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitReply(parentId, replyBody) {
    const trimmed = replyBody.trim();
    if (!currentUserId || !itemId || !parentId || !trimmed) return false;
    setSavingReplyId(parentId);
    setError("");
    try {
      const parentReview = reviews.find((item) => String(item.id) === String(parentId));
      const rootOwnerId = getRootOwnerId(reviews, parentId);
      if (parentReview?.user_id && String(parentReview.user_id) === String(currentUserId)) {
        setError("You cannot reply to your own post.");
        return false;
      }
      const blocked = await usersAreBlocked(currentUserId, [parentReview?.user_id, rootOwnerId]);
      if (blocked) {
        setBlockedUserIds(await loadBlockedUserIds(currentUserId));
        setError("You cannot reply because one of you has blocked the other.");
        return false;
      }
      const { error: insertError } = await supabase.from(config.reviewTable).insert({
        [config.itemColumn]: itemId,
        user_id: currentUserId,
        parent_id: parentId,
        body: trimmed,
      });
      if (insertError) throw insertError;
      await loadReviews();
      return true;
    } catch (err) {
      console.error("Failed posting reply:", err);
      setError(err.message || "Failed posting reply");
      return false;
    } finally {
      setSavingReplyId(null);
    }
  }

  async function handleEditReview(reviewId, updatedBody, options = {}) {
    const trimmed = updatedBody.trim();
    if (!currentUserId || !reviewId || !trimmed) return false;
    const targetReview = reviews.find((review) => String(review.id) === String(reviewId));
    if (!targetReview || String(targetReview.user_id) !== String(currentUserId)) {
      setError("You can only edit your own review.");
      return false;
    }
    const hasReplies = reviews.some((review) => String(review.parent_id || "") === String(reviewId));
    const shouldAppend = Boolean(options.appendOnly || hasReplies);
    const nextBody = shouldAppend ? `${targetReview.body || ""}\n\n${trimmed}`.trim() : trimmed;
    setSavingEditId(reviewId);
    setError("");
    try {
      const { data, error: updateError } = await supabase
        .from(config.reviewTable)
        .update({ body: nextBody, updated_at: new Date().toISOString() })
        .eq("id", reviewId)
        .eq("user_id", currentUserId)
        .select("id");
      if (updateError) throw updateError;
      if (!data?.length) throw new Error("The review was not updated.");
      await loadReviews();
      return true;
    } catch (err) {
      console.error("Failed editing review:", err);
      setError(err.message || "Failed editing review");
      return false;
    } finally {
      setSavingEditId(null);
    }
  }

  async function handleDeleteReview(reviewId) {
    if (!currentUserId || !reviewId) return false;
    const confirmed = window.confirm("Delete this post permanently?");
    if (!confirmed) return false;
    setDeletingId(reviewId);
    setError("");
    try {
      const { error: deleteError } = await supabase.rpc("delete_owned_thread_item", {
        p_table_name: config.reviewTable,
        p_item_id: reviewId,
      });
      if (deleteError) throw deleteError;
      await loadReviews();
      return true;
    } catch (err) {
      console.error("Failed deleting review:", err);
      setError(err.message || "Failed deleting post");
      return false;
    } finally {
      setDeletingId(null);
    }
  }

  function handleLocalVoteChanged(reviewId, nextVote, previousVote) {
    setReviews((prev) =>
      prev.map((review) => {
        if (String(review.id) !== String(reviewId)) return review;
        let up = Number(review.up_count || 0);
        let down = Number(review.down_count || 0);
        if (previousVote === 1) up -= 1;
        if (previousVote === -1) down -= 1;
        if (nextVote === 1) up += 1;
        if (nextVote === -1) down += 1;
        return { ...review, up_count: Math.max(0, up), down_count: Math.max(0, down), my_vote: nextVote };
      })
    );
  }

  return (
    <section className={config.sectionClass || "msd-reviews-section"}>
      <h2 className={config.headingClass || "msd-section-title"}>{heading}</h2>
      {subheading ? <p className="msd-muted">{subheading}</p> : null}

      {currentUserId && !hasPostedRootReview ? (
        <form className="msd-review-form" onSubmit={handleSubmitReview}>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={config.placeholder || "Write your review..."}
            rows={config.rows || 5}
            maxLength={2000}
          />
          <div className="msd-review-form-actions">
            <span className="msd-review-char-count">{body.trim().length}/2000</span>
            <div className="msd-review-form-buttons">
              <button type="submit" className="msd-btn msd-btn-primary" disabled={saving || !body.trim()}>
                {saving ? "Posting..." : "Post review"}
              </button>
            </div>
          </div>
        </form>
      ) : !currentUserId ? (
        <div className="msd-review-login-note">Log in to write a review.</div>
      ) : null}

      {error ? <div className="msd-review-error">{error}</div> : null}

      {loading ? (
        <p className="msd-muted">Loading reviews...</p>
      ) : reviewTree.length > 0 ? (
        <div className="msd-review-list">
          {reviewTree.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              config={config}
              currentUserId={currentUserId}
              blockedUserIds={blockedUserIds}
              rootOwnerId={review.user_id}
              onReply={handleSubmitReply}
              onEdit={handleEditReview}
              onDelete={handleDeleteReview}
              savingReplyId={savingReplyId}
              savingEditId={savingEditId}
              deletingId={deletingId}
              onVoteChanged={handleLocalVoteChanged}
            />
          ))}
        </div>
      ) : (
        <p className="msd-muted">No reviews yet. Be the first to write one.</p>
      )}
    </section>
  );
}
