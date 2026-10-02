import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import "./BlockedUsersSection.css";

const BURGRS_TV_PROFILE_ID = "add17d5c-c8fd-4430-904f-271342100bf9";

function isProtectedBurgrsTvProfile(profile) {
  if (!profile) return false;
  if (String(profile.id || "") === BURGRS_TV_PROFILE_ID) return true;

  return [profile.username, profile.display_name, profile.full_name]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes("burgrs tv");
}

function getName(profile) {
  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    "BURGRS user"
  );
}

function getProfileHref(profile) {
  const slug = profile?.username || profile?.id;
  return slug ? `/u/${encodeURIComponent(slug)}` : "#";
}

function normalizeSearch(value) {
  return String(value || "").trim().replace(/^@/, "");
}

export default function BlockedUsersSection() {
  const [currentUserId, setCurrentUserId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [blockedProfiles, setBlockedProfiles] = useState([]);
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  const [followingIds, setFollowingIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [followSavingId, setFollowSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const visibleResults = useMemo(
    () =>
      results.filter(
        (profile) =>
          profile.id !== currentUserId && !isProtectedBurgrsTvProfile(profile)
      ),
    [results, currentUserId]
  );

  async function loadBlockedUsers(userId = currentUserId) {
    if (!userId) return;

    setLoading(true);
    setError("");

    try {
      const { data: blockRows, error: blockError } = await supabase
        .from("user_blocks")
        .select("blocked_id, created_at")
        .eq("blocker_id", userId)
        .order("created_at", { ascending: false });

      if (blockError) throw blockError;

      const ids = (blockRows || []).map((row) => row.blocked_id).filter(Boolean);
      setBlockedIds(new Set(ids));

      if (!ids.length) {
        setBlockedProfiles([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, full_name, display_name, avatar_url")
        .in("id", ids);

      if (profilesError) throw profilesError;

      const profileMap = new Map(
        (profiles || []).map((profile) => [String(profile.id), profile])
      );

      setBlockedProfiles(
        ids
          .map((id) => profileMap.get(String(id)) || { id })
          .filter(Boolean)
      );
    } catch (err) {
      console.error("Failed loading blocked users:", err);
      setError(
        err.message ||
          "Blocked users could not be loaded. Run supabase/user_blocks.sql."
      );
      setBlockedProfiles([]);
      setBlockedIds(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError || !data?.user?.id) {
        setLoading(false);
        return;
      }

      setCurrentUserId(data.user.id);
      loadBlockedUsers(data.user.id);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const cleanQuery = normalizeSearch(query);
    if (cleanQuery.length < 2 || !currentUserId) {
      setResults([]);
      setFollowingIds(new Set());
      setSearching(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError("");

      try {
        const escaped = cleanQuery.replace(/[%_,()]/g, "");
        const { data, error: searchError } = await supabase
          .from("profiles")
          .select("id, username, full_name, display_name, avatar_url")
          .or(
            `username.ilike.%${escaped}%,full_name.ilike.%${escaped}%,display_name.ilike.%${escaped}%`
          )
          .neq("id", currentUserId)
          .limit(12);

        if (searchError) throw searchError;

        const profiles = data || [];
        if (active) setResults(profiles);

        const profileIds = profiles.map((profile) => profile.id).filter(Boolean);
        if (!profileIds.length) {
          if (active) setFollowingIds(new Set());
          return;
        }

        const { data: followRows, error: followError } = await supabase
          .from("user_follows")
          .select("following_id")
          .eq("follower_id", currentUserId)
          .in("following_id", profileIds);

        if (followError) {
          console.warn("Failed loading follow state for user search:", followError);
          if (active) setFollowingIds(new Set());
          return;
        }

        if (active) {
          setFollowingIds(
            new Set((followRows || []).map((row) => row.following_id).filter(Boolean))
          );
        }
      } catch (err) {
        console.error("Failed searching users:", err);
        if (active) setError(err.message || "Users could not be searched.");
      } finally {
        if (active) setSearching(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, currentUserId]);

  async function toggleFollow(profile) {
    if (
      !currentUserId ||
      !profile?.id ||
      savingId ||
      followSavingId ||
      blockedIds.has(profile.id) ||
      isProtectedBurgrsTvProfile(profile)
    ) {
      return;
    }

    const isFollowing = followingIds.has(profile.id);
    setFollowSavingId(profile.id);
    setError("");
    setMessage("");

    try {
      if (isFollowing) {
        const { error: unfollowError } = await supabase
          .from("user_follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profile.id);

        if (unfollowError) throw unfollowError;
      } else {
        const { error: followError } = await supabase.from("user_follows").insert({
          follower_id: currentUserId,
          following_id: profile.id,
        });

        if (followError && followError.code !== "23505") throw followError;
      }

      setFollowingIds((current) => {
        const next = new Set(current);
        if (isFollowing) next.delete(profile.id);
        else next.add(profile.id);
        return next;
      });

      setMessage(
        isFollowing
          ? `You unfollowed ${getName(profile)}.`
          : `You are now following ${getName(profile)}.`
      );

      window.dispatchEvent(
        new CustomEvent("burgrs:user-follows-changed", {
          detail: { followedUserId: profile.id, isFollowing: !isFollowing },
        })
      );
    } catch (err) {
      console.error("Failed updating follow:", err);
      setError(err.message || "This follow could not be updated.");
    } finally {
      setFollowSavingId("");
    }
  }

  async function blockUser(profile) {
    if (
      !currentUserId ||
      !profile?.id ||
      savingId ||
      followSavingId ||
      isProtectedBurgrsTvProfile(profile)
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Block ${getName(profile)}? You will unfollow each other and they will no longer be able to follow or notify you.`
    );
    if (!confirmed) return;

    setSavingId(profile.id);
    setError("");
    setMessage("");

    try {
      const { error: blockError } = await supabase.from("user_blocks").insert({
        blocker_id: currentUserId,
        blocked_id: profile.id,
      });

      if (blockError && blockError.code !== "23505") throw blockError;

      await loadBlockedUsers(currentUserId);
      setFollowingIds((current) => {
        const next = new Set(current);
        next.delete(profile.id);
        return next;
      });
      setResults((current) =>
        current.map((item) =>
          item.id === profile.id ? { ...item, is_blocked: true } : item
        )
      );
      setMessage(`${getName(profile)} has been blocked.`);
      window.dispatchEvent(
        new CustomEvent("burgrs:user-blocks-changed", {
          detail: { blockedUserId: profile.id, isBlocked: true },
        })
      );
    } catch (err) {
      console.error("Failed blocking user:", err);
      setError(err.message || "This user could not be blocked.");
    } finally {
      setSavingId("");
    }
  }

  async function unblockUser(profile) {
    if (!currentUserId || !profile?.id || savingId || followSavingId) return;

    setSavingId(profile.id);
    setError("");
    setMessage("");

    try {
      const { error: unblockError } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", currentUserId)
        .eq("blocked_id", profile.id);

      if (unblockError) throw unblockError;

      await loadBlockedUsers(currentUserId);
      setMessage(`${getName(profile)} has been unblocked.`);
      window.dispatchEvent(
        new CustomEvent("burgrs:user-blocks-changed", {
          detail: { blockedUserId: profile.id, isBlocked: false },
        })
      );
    } catch (err) {
      console.error("Failed unblocking user:", err);
      setError(err.message || "This user could not be unblocked.");
    } finally {
      setSavingId("");
    }
  }

  function UserRow({ profile, blocked }) {
    const name = getName(profile);
    const initial = name.slice(0, 1).toUpperCase();
    const isFollowing = followingIds.has(profile.id);
    const isBlockSaving = savingId === profile.id;
    const isFollowSaving = followSavingId === profile.id;

    return (
      <article className="blocked-user-row">
        <a href={getProfileHref(profile)} className="blocked-user-profile-link">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span className="blocked-user-avatar-fallback">{initial}</span>
          )}
          <span className="blocked-user-copy">
            <strong>{name}</strong>
            {profile.username ? <small>@{profile.username}</small> : null}
          </span>
        </a>

        <div className={`blocked-user-actions${blocked ? " is-blocked" : ""}`}>
          {!blocked ? (
            <button
              type="button"
              className={`blocked-user-follow${isFollowing ? " is-following" : ""}`}
              onClick={() => toggleFollow(profile)}
              disabled={isBlockSaving || isFollowSaving}
            >
              {isFollowSaving ? "Saving..." : isFollowing ? "Following" : "Follow"}
            </button>
          ) : null}

          <button
            type="button"
            className={blocked ? "blocked-user-unblock" : "blocked-user-block"}
            onClick={() => (blocked ? unblockUser(profile) : blockUser(profile))}
            disabled={isBlockSaving || isFollowSaving}
          >
            {isBlockSaving ? "Saving..." : blocked ? "Unblock" : "Block"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="blocked-users-section" aria-labelledby="blocked-users-title">
      <div className="blocked-users-heading">
        <h2 id="blocked-users-title">Find and block users</h2>
        <p>
          Find and block another user, or manage people you have already blocked.
        </p>
      </div>

      {error ? <div className="blocked-users-alert is-error">{error}</div> : null}
      {message ? (
        <div className="blocked-users-alert is-success">{message}</div>
      ) : null}

      <label className="blocked-users-search">
        <span>Find a user</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search username or display name"
          autoComplete="off"
        />
      </label>

      {searching ? <p className="blocked-users-muted">Searching...</p> : null}

      {normalizeSearch(query).length >= 2 && !searching ? (
        visibleResults.length ? (
          <div className="blocked-users-list">
            {visibleResults.map((profile) => (
              <UserRow
                key={profile.id}
                profile={profile}
                blocked={blockedIds.has(profile.id)}
              />
            ))}
          </div>
        ) : (
          <p className="blocked-users-muted">No matching users found.</p>
        )
      ) : null}

      <div className="blocked-users-subheading">
        <h3>People you have blocked</h3>
        <span>{blockedProfiles.length}</span>
      </div>

      {loading ? (
        <p className="blocked-users-muted">Loading blocked users...</p>
      ) : blockedProfiles.length ? (
        <div className="blocked-users-list">
          {blockedProfiles.map((profile) => (
            <UserRow key={profile.id} profile={profile} blocked />
          ))}
        </div>
      ) : (
        <p className="blocked-users-muted">You have not blocked anyone.</p>
      )}
    </section>
  );
}
