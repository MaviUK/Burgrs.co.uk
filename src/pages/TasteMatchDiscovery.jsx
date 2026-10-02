import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./TasteMatchDiscovery.css";

const MODES = [
  ["closest", "Closest"],
  ["new", "New people"],
  ["favourites", "Shared favourites"],
  ["opposites", "Opposites"],
];

function profileName(profile) {
  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    "BURGRS user"
  );
}

function profileHref(profile) {
  return profile?.username
    ? `/u/${encodeURIComponent(profile.username)}`
    : "/";
}

export default function TasteMatchDiscovery() {
  const [mode, setMode] = useState("closest");
  const [minShared, setMinShared] = useState(0);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const token = sessionData?.session?.access_token;
        if (!token) throw new Error("You must be logged in.");

        const params = new URLSearchParams({
          mode,
          minShared: String(minShared),
          limit: "40",
        });

        const response = await fetch(
          `/.netlify/functions/taste-match-users?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load Taste Matches.");
        }

        if (active) setMatches(payload?.matches || []);
      } catch (err) {
        if (active) {
          setError(err.message || "Could not load Taste Matches.");
          setMatches([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [mode, minShared]);

  const description = useMemo(() => {
    if (mode === "new") return "People you do not currently follow, ordered by TV taste.";
    if (mode === "favourites") return "People who share the most 80%+ favourites with you.";
    if (mode === "opposites") return "The users whose TV taste differs most from yours.";
    return "The BURGRS users whose ratings, Rank'd lists and libraries are closest to yours.";
  }, [mode]);

  return (
    <main className="taste-discovery-page">
      <header className="taste-discovery-header">
        <span>Taste Match</span>
        <h1>Find your TV people</h1>
        <p>{description}</p>
      </header>

      <div className="taste-discovery-controls">
        <div className="taste-discovery-tabs">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={mode === key ? "is-active" : ""}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="taste-discovery-filter">
          <span>Minimum shared ratings</span>
          <select
            value={minShared}
            onChange={(event) => setMinShared(Number(event.target.value))}
          >
            <option value={0}>Any</option>
            <option value={3}>3+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
            <option value={20}>20+</option>
          </select>
        </label>
      </div>

      {error ? <p className="taste-discovery-error">{error}</p> : null}

      {loading ? (
        <p className="taste-discovery-muted">Finding your Taste Matches...</p>
      ) : matches.length ? (
        <div className="taste-discovery-grid">
          {matches.map((match) => {
            const profile = match.profile || {};
            const name = profileName(profile);
            const avatar = profile.avatar_url || "";
            const initial = name.slice(0, 1).toUpperCase();

            return (
              <Link
                key={profile.id}
                to={profileHref(profile)}
                className="taste-discovery-card"
              >
                <div className="taste-discovery-top">
                  {avatar ? (
                    <img src={avatar} alt="" />
                  ) : (
                    <div className="taste-discovery-avatar-fallback">{initial}</div>
                  )}
                  <div className="taste-discovery-score">
                    <strong>{Math.round(Number(match.score || 0))}%</strong>
                    <span>{match.confidence || "Taste Match"}</span>
                  </div>
                </div>

                <div className="taste-discovery-copy">
                  <strong>{name}</strong>
                  {profile.username ? <span>@{profile.username}</span> : null}
                </div>

                <div className="taste-discovery-stats">
                  <div>
                    <strong>{match.shared_ratings || 0}</strong>
                    <span>Shared ratings</span>
                  </div>
                  <div>
                    <strong>{match.shared_favourites || 0}</strong>
                    <span>Shared favourites</span>
                  </div>
                  <div>
                    <strong>
                      {match.total_show_match == null
                        ? "--"
                        : `${match.total_show_match}%`}
                    </strong>
                    <span>Library match</span>
                  </div>
                </div>

                <small>
                  {match.following ? "Following" : "View profile and compare"}
                </small>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="taste-discovery-muted">
          No users match these filters yet. Try lowering the shared-rating minimum.
        </p>
      )}
    </main>
  );
}
