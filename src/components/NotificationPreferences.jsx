import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const DEFAULTS = {
  follow: true,
  review_reply: true,
  chat_reply: true,
  creator_post_comment: true,
  creator_list_comment: true,
  airing_today: true,
  new_season: true,
  season_premiere_date: true,
};

const GROUPS = [
  {
    title: "Social",
    items: [
      ["follow", "New followers", "When someone starts following you."],
      ["review_reply", "Review replies", "When someone replies to one of your show reviews."],
      ["chat_reply", "Chatboard replies", "When someone replies to your chatboard message."],
      ["creator_post_comment", "Creator post comments", "Comments and replies on your creator posts."],
      ["creator_list_comment", "Creator list comments", "Comments on your creator lists and Rank’d Top 10."],
    ],
  },
  {
    title: "My Shows",
    items: [
      ["airing_today", "Airing today", "A morning alert when an episode from My Shows airs today."],
      ["new_season", "New season announced", "When BURGRS discovers a new season for a show in My Shows."],
      ["season_premiere_date", "Season premiere date", "When a first-air date is added for an upcoming season."],
    ],
  },
];

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 14,
  alignItems: "center",
  padding: "13px 0",
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

export default function NotificationPreferences({ sectionStyle }) {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        const user = authData?.user;
        if (!user) return;

        const { data, error: loadError } = await supabase
          .from("notification_preferences")
          .select("follow, review_reply, chat_reply, creator_post_comment, creator_list_comment, airing_today, new_season, season_premiere_date")
          .eq("user_id", user.id)
          .maybeSingle();

        if (loadError) throw loadError;
        if (!active) return;

        setPrefs({ ...DEFAULTS, ...(data || {}) });
      } catch (err) {
        console.error("Failed loading notification preferences:", err);
        if (active) setError(err.message || "Could not load notification settings.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const allOn = useMemo(() => Object.values(prefs).every(Boolean), [prefs]);

  async function save(nextPrefs, key) {
    setSavingKey(key);
    setError("");
    setMessage("");

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) throw new Error("You must be logged in.");

      const { error: saveError } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: user.id,
            ...nextPrefs,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (saveError) throw saveError;
      setPrefs(nextPrefs);
      setMessage("Notification settings saved.");
    } catch (err) {
      console.error("Failed saving notification preferences:", err);
      setError(err.message || "Could not save notification settings.");
    } finally {
      setSavingKey("");
    }
  }

  function toggle(key) {
    if (savingKey) return;
    const next = { ...prefs, [key]: !prefs[key] };
    save(next, key);
  }

  function toggleAll() {
    if (savingKey) return;
    const nextValue = !allOn;
    const next = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, nextValue]));
    save(next, "all");
  }

  return (
    <section style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: "#f8fafc" }}>Notifications</h2>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 14, lineHeight: 1.45 }}>
            Choose which BURGRS alerts you want to receive. Turning one off stops both the in-app alert and Android push.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          disabled={loading || Boolean(savingKey)}
          style={{
            border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            color: "#f8fafc",
            padding: "8px 11px",
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {allOn ? "Turn all off" : "Turn all on"}
        </button>
      </div>

      {error ? (
        <p style={{ margin: "12px 0 0", color: "#fecaca", fontSize: 13 }}>{error}</p>
      ) : null}
      {message ? (
        <p style={{ margin: "12px 0 0", color: "#bbf7d0", fontSize: 13 }}>{message}</p>
      ) : null}

      {loading ? (
        <p style={{ margin: "16px 0 0", color: "#94a3b8" }}>Loading notification settings...</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {GROUPS.map((group) => (
            <div key={group.title} style={{ marginTop: group.title === GROUPS[0].title ? 0 : 18 }}>
              <h3 style={{ margin: "0 0 2px", color: "#e2e8f0", fontSize: 14 }}>{group.title}</h3>
              {group.items.map(([key, label, description], index) => {
                const enabled = prefs[key];
                return (
                  <div
                    key={key}
                    style={{
                      ...rowStyle,
                      borderBottom:
                        index === group.items.length - 1
                          ? "none"
                          : rowStyle.borderBottom,
                    }}
                  >
                    <div>
                      <div style={{ color: "#f8fafc", fontWeight: 800, fontSize: 14 }}>{label}</div>
                      <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>
                        {description}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={label}
                      onClick={() => toggle(key)}
                      disabled={Boolean(savingKey)}
                      style={{
                        width: 48,
                        height: 28,
                        borderRadius: 999,
                        border: enabled ? "1px solid #970747" : "1px solid rgba(148,163,184,0.35)",
                        background: enabled ? "#970747" : "#334155",
                        padding: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: enabled ? "flex-end" : "flex-start",
                        cursor: savingKey ? "wait" : "pointer",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: "#ffffff",
                          display: "block",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
