import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./AdminHealth.css";

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metricStatus(value, warningAt = 1) {
  return Number(value || 0) >= warningAt ? "warn" : "ok";
}

export default function AdminHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("You must be logged in.");

      const response = await fetch("/.netlify/functions/admin-health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Could not load admin health.");
      }

      setHealth(payload?.health || null);
    } catch (err) {
      setError(err.message || "Could not load admin health.");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <main className="admin-health-page">
        <p className="admin-health-muted">Loading BURGRS health...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="admin-health-page">
        <h1>System health</h1>
        <p className="admin-health-error">{error}</p>
      </main>
    );
  }

  const shows = health?.shows || {};
  const queue = health?.queue || {};
  const news = health?.news || {};
  const notifications = health?.notifications || {};
  const devices = health?.devices || {};
  const cron = health?.cron || {};

  const metrics = [
    ["Shows", shows.total_shows ?? 0, "neutral"],
    ["Stale >24h", shows.stale_24h ?? 0, metricStatus(shows.stale_24h)],
    ["Stale >7d", shows.stale_7d ?? 0, metricStatus(shows.stale_7d)],
    ["Queue pending", queue.pending ?? 0, metricStatus(queue.pending, 10)],
    ["High priority", queue.high_priority_pending ?? 0, metricStatus(queue.high_priority_pending)],
    ["Queue failed", queue.failed ?? 0, metricStatus(queue.failed)],
    ["Retries", queue.retries ?? 0, metricStatus(queue.retries, 5)],
    ["Cron failures 24h", cron.failures_24h ?? 0, metricStatus(cron.failures_24h)],
    ["News errors 24h", news.errors_24h ?? 0, metricStatus(news.errors_24h)],
    ["Android devices", devices.active_android_devices ?? 0, "neutral"],
    ["Notifications 24h", notifications.created_24h ?? 0, "neutral"],
    ["For You alerts 24h", notifications.for_you_24h ?? 0, "neutral"],
  ];

  return (
    <main className="admin-health-page">
      <header className="admin-health-header">
        <div>
          <span>Burgrs TV admin</span>
          <h1>System health</h1>
          <p>
            Live status for show freshness, priority syncs, news, notifications and cron jobs.
          </p>
        </div>
        <button type="button" onClick={load}>Refresh</button>
      </header>

      <section className="admin-health-grid">
        {metrics.map(([label, value, state]) => (
          <div key={label} className={`admin-health-metric is-${state}`}>
            <strong>{Number(value).toLocaleString("en-GB")}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="admin-health-card">
        <h2>Freshness</h2>
        <div className="admin-health-detail-grid">
          <div><span>Last TVDB show sync</span><strong>{formatDate(shows.last_tvdb_sync)}</strong></div>
          <div><span>Last TMDB rating sync</span><strong>{formatDate(shows.last_tmdb_rating_sync)}</strong></div>
          <div><span>Oldest pending job</span><strong>{formatDate(queue.oldest_pending)}</strong></div>
          <div><span>Latest notification</span><strong>{formatDate(notifications.last_notification)}</strong></div>
          <div><span>Latest news run</span><strong>{formatDate(news.last_run)}</strong></div>
          <div><span>News status</span><strong>{news.latest_status || "Unknown"}</strong></div>
          <div><span>Enabled news sources</span><strong>{news.enabled_sources ?? 0}</strong></div>
          <div><span>Active cron jobs</span><strong>{cron.active_jobs ?? 0}</strong></div>
        </div>
      </section>

      <section className="admin-health-card">
        <div className="admin-health-section-head">
          <h2>Stale shows</h2>
          <span>Oldest records first</span>
        </div>
        <div className="admin-health-list">
          {(health?.stale_shows || []).length ? (
            health.stale_shows.map((show) => (
              <Link
                key={show.id}
                to={show.tmdb_id ? `/show/tmdb/${show.tmdb_id}` : `/show/${show.tvdb_id || show.id}`}
                className="admin-health-row"
              >
                <div>
                  <strong>{show.name || "Unknown show"}</strong>
                  <span>{show.status || "No status"}</span>
                </div>
                <small>{formatDate(show.last_synced_at)}</small>
              </Link>
            ))
          ) : (
            <p className="admin-health-muted">No stale shows.</p>
          )}
        </div>
      </section>

      <section className="admin-health-card">
        <div className="admin-health-section-head">
          <h2>Retry / failure activity</h2>
          <span>Recent queue items with attempts or errors</span>
        </div>
        <div className="admin-health-list">
          {(health?.queue_failures || []).length ? (
            health.queue_failures.map((item) => (
              <div key={`${item.show_id}-${item.updated_at}`} className="admin-health-row">
                <div>
                  <strong>{item.show_name || "Unknown show"}</strong>
                  <span>
                    Priority {item.priority ?? "--"} · Attempts {item.attempts ?? 0}
                    {Array.isArray(item.reasons) && item.reasons.length
                      ? ` · ${item.reasons.join(", ")}`
                      : ""}
                  </span>
                  {item.last_error ? <em>{item.last_error}</em> : null}
                </div>
                <small>{formatDate(item.updated_at)}</small>
              </div>
            ))
          ) : (
            <p className="admin-health-muted">No retry or failure activity.</p>
          )}
        </div>
      </section>

      <section className="admin-health-card">
        <div className="admin-health-section-head">
          <h2>Cron failures</h2>
          <span>Past 24 hours</span>
        </div>
        <div className="admin-health-list">
          {(health?.cron_failures || []).length ? (
            health.cron_failures.map((item) => (
              <div key={`${item.jobid}-${item.start_time}`} className="admin-health-row">
                <div>
                  <strong>{item.jobname || `Job ${item.jobid}`}</strong>
                  <span>{item.status || "failed"}</span>
                  {item.return_message ? <em>{item.return_message}</em> : null}
                </div>
                <small>{formatDate(item.start_time)}</small>
              </div>
            ))
          ) : (
            <p className="admin-health-muted">No cron failures in the last 24 hours.</p>
          )}
        </div>
      </section>

      <p className="admin-health-generated">
        Snapshot generated {formatDate(health?.generated_at)}
      </p>
    </main>
  );
}
