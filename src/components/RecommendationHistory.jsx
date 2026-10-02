import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const LABELS = {
  not_interested: ["Not for me", "This show will stay out of For You."],
  more_like: ["More like this", "Similar shows get a positive boost."],
  less_like: ["Less like this", "Similar shows are shown less often."],
  added: ["Added from For You", "Adding this show is a positive recommendation signal."],
};

function showHref(show) {
  if (show?.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  if (show?.tvdb_id) return `/show/${show.tvdb_id}`;
  return `/show/${show?.id || ""}`;
}

export default function RecommendationHistory({ sectionStyle }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) return;

      const { data, error: queryError } = await supabase
        .from("recommendation_feedback")
        .select("show_id, feedback_type, created_at, updated_at, shows:show_id(id,name,poster_url,tmdb_id,tvdb_id)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (queryError) throw queryError;
      setRows(data || []);
    } catch (err) {
      setError(err.message || "Could not load recommendation history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function undo(row) {
    const showId = String(row?.show_id || "");
    if (!showId || savingId) return;
    setSavingId(showId);
    setError("");

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) throw new Error("You must be logged in.");

      const { error } = await supabase
        .from("recommendation_feedback")
        .delete()
        .eq("user_id", user.id)
        .eq("show_id", showId);

      if (error) throw error;
      setRows((current) => current.filter((item) => String(item.show_id) !== showId));
    } catch (err) {
      setError(err.message || "Could not undo this recommendation choice.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ margin: "0 0 6px", color: "#f8fafc" }}>Recommendation history</h2>
      <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.45 }}>
        Review the signals BURGRS uses for For You. You can undo any choice here.
      </p>

      {error ? <p style={{ color: "#fecaca", fontSize: 12 }}>{error}</p> : null}

      {loading ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading recommendation history...</p>
      ) : rows.length ? (
        <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
          {rows.map((row) => {
            const show = row.shows || {};
            const label = LABELS[row.feedback_type] || [row.feedback_type, ""];
            return (
              <div
                key={row.show_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "42px minmax(0,1fr) auto",
                  gap: 10,
                  alignItems: "center",
                  padding: 9,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(148,163,184,0.12)",
                }}
              >
                {show.poster_url ? (
                  <img
                    src={show.poster_url}
                    alt=""
                    style={{ width: 42, height: 62, borderRadius: 8, objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: 42, height: 62, borderRadius: 8, background: "#1e293b" }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <Link
                    to={showHref(show)}
                    style={{ color: "#f8fafc", fontWeight: 900, fontSize: 13, textDecoration: "none" }}
                  >
                    {show.name || "Show"}
                  </Link>
                  <div style={{ color: "#f9a8d4", fontSize: 11, fontWeight: 850, marginTop: 3 }}>
                    {label[0]}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
                    {label[1]}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => undo(row)}
                  disabled={savingId === String(row.show_id)}
                  style={{
                    border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.04)",
                    color: "#e2e8f0",
                    padding: "7px 9px",
                    fontSize: 10,
                    fontWeight: 850,
                  }}
                >
                  {savingId === String(row.show_id) ? "Undoing..." : "Undo"}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 14 }}>
          No recommendation choices yet.
        </p>
      )}
    </section>
  );
}
