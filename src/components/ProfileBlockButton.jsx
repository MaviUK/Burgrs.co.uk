import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./ProfileBlockButton.css";

const BURGRS_TV_PROFILE_ID = "add17d5c-c8fd-4430-904f-271342100bf9";

function getName(profile) {
  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    "this user"
  );
}

function isProtectedBurgrsTvProfile(profile) {
  if (!profile) return false;
  if (String(profile.id || "") === BURGRS_TV_PROFILE_ID) return true;

  return [profile.username, profile.display_name, profile.full_name]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes("burgrs tv");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function clearCreatorBlockClasses() {
  document.querySelectorAll(".creator-page").forEach((page) => {
    page.classList.remove(
      "has-user-block",
      "is-blocked-by-me",
      "is-blocked-by-them"
    );
  });
}

export default function ProfileBlockButton() {
  const location = useLocation();
  const [mountNode, setMountNode] = useState(null);
  const [profile, setProfile] = useState(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockedEitherWay, setBlockedEitherWay] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isProfileRoute = location.pathname.startsWith("/u/");
  const blockedByThem = blockedEitherWay && !blockedByMe;

  useEffect(() => {
    if (!isProfileRoute) {
      setMountNode(null);
      setProfile(null);
      clearCreatorBlockClasses();
      return undefined;
    }

    let frameId = 0;

    function findMount() {
      const actions = document.querySelector(".creator-actions");
      setMountNode(actions || null);
    }

    function scheduleFind() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(findMount);
    }

    scheduleFind();
    const observer = new MutationObserver(scheduleFind);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      setMountNode(null);
      clearCreatorBlockClasses();
    };
  }, [isProfileRoute, location.pathname]);

  useEffect(() => {
    clearCreatorBlockClasses();

    const page = document.querySelector(".creator-page");
    if (!page || !blockedEitherWay) return undefined;

    page.classList.add("has-user-block");
    page.classList.toggle("is-blocked-by-me", blockedByMe);
    page.classList.toggle("is-blocked-by-them", blockedByThem);

    document.querySelector('[data-creator-rankd-list-modal="true"]')?.remove();
    document.body.classList.remove("creator-rankd-modal-open");

    return () => clearCreatorBlockClasses();
  }, [blockedEitherWay, blockedByMe, blockedByThem, mountNode]);

  useEffect(() => {
    if (!isProfileRoute) return undefined;

    let active = true;
    const slug = decodeURIComponent(location.pathname.split("/u/")[1] || "")
      .split("/")[0]
      .replace(/^@/, "");

    async function loadState() {
      setLoading(true);
      setError("");

      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;

        let profileResult = await supabase
          .from("profiles")
          .select("id, username, full_name, display_name")
          .eq("username", slug)
          .maybeSingle();

        if (!profileResult.data && !profileResult.error && isUuid(slug)) {
          profileResult = await supabase
            .from("profiles")
            .select("id, username, full_name, display_name")
            .eq("id", slug)
            .maybeSingle();
        }

        if (profileResult.error) throw profileResult.error;
        if (!active) return;

        const user = authData?.user || null;
        const profileRow = profileResult.data || null;

        setCurrentUserId(user?.id || "");
        setProfile(profileRow);

        if (!user?.id || !profileRow?.id || user.id === profileRow.id) {
          setBlockedByMe(false);
          setBlockedEitherWay(false);
          return;
        }

        const { data: blockRows, error: blockError } = await supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .or(
            `and(blocker_id.eq.${user.id},blocked_id.eq.${profileRow.id}),and(blocker_id.eq.${profileRow.id},blocked_id.eq.${user.id})`
          );

        if (blockError) throw blockError;
        if (!active) return;

        const rows = blockRows || [];
        const isBlockedByMe = rows.some(
          (row) =>
            row.blocker_id === user.id && row.blocked_id === profileRow.id
        );

        setBlockedByMe(isBlockedByMe);
        setBlockedEitherWay(rows.length > 0);
      } catch (err) {
        console.error("Failed loading block state:", err);
        if (active) setError(err.message || "Block status could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadState();

    const handleBlocksChanged = () => loadState();
    window.addEventListener("burgrs:user-blocks-changed", handleBlocksChanged);

    return () => {
      active = false;
      window.removeEventListener(
        "burgrs:user-blocks-changed",
        handleBlocksChanged
      );
    };
  }, [isProfileRoute, location.pathname]);

  async function toggleBlock() {
    if (!currentUserId || !profile?.id || saving) return;

    if (!blockedByMe) {
      const confirmed = window.confirm(
        `Block ${getName(profile)}? You will unfollow each other and they will no longer be able to follow or notify you.`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError("");

    try {
      if (blockedByMe) {
        const { error: unblockError } = await supabase
          .from("user_blocks")
          .delete()
          .eq("blocker_id", currentUserId)
          .eq("blocked_id", profile.id);

        if (unblockError) throw unblockError;
        setBlockedByMe(false);
        setBlockedEitherWay(false);
      } else {
        const { error: blockError } = await supabase.from("user_blocks").insert({
          blocker_id: currentUserId,
          blocked_id: profile.id,
        });

        if (blockError && blockError.code !== "23505") throw blockError;
        setBlockedByMe(true);
        setBlockedEitherWay(true);
      }

      window.dispatchEvent(
        new CustomEvent("burgrs:user-blocks-changed", {
          detail: {
            blockedUserId: profile.id,
            isBlocked: !blockedByMe,
          },
        })
      );
      window.setTimeout(() => window.location.reload(), 250);
    } catch (err) {
      console.error("Failed updating block:", err);
      setError(err.message || "Block status could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (
    !mountNode ||
    !profile?.id ||
    !currentUserId ||
    currentUserId === profile.id ||
    blockedByThem ||
    isProtectedBurgrsTvProfile(profile)
  ) {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className={`creator-btn creator-profile-block-button${
          blockedByMe ? " is-blocked" : ""
        }`}
        onClick={toggleBlock}
        disabled={loading || saving}
      >
        {saving ? "Saving..." : blockedByMe ? "Unblock user" : "Block user"}
      </button>
      {error ? <span className="creator-profile-block-error">{error}</span> : null}
    </>,
    mountNode
  );
}
