import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./AdminHealth.css";

const SECTIONS = [
  ["overview", "Overview"],
  ["automations", "Automations"],
  ["issues", "Issues"],
  ["data", "Data health"],
];

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

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return (Date.now() - date.getTime()) / 3600000;
}

function StatePill({ state = "neutral", children }) {
  return <span className={`admin-state-pill is-${state}`}>{children}</span>;
}

function Metric({ label, value, note, state = "neutral" }) {
  return (
    <div className={`admin-health-metric is-${state}`}>
      <strong>{formatNumber(value)}</strong>
      <span>{label}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export default function AdminHealth() {
  const [dashboard, setDashboard] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load({ background = false } = {}) {
    if (background) setRefreshing(true);
    else setLoading(true);
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
        throw new Error(payload?.error || "Could not load admin dashboard.");
      }

      setDashboard(
        payload?.dashboard ||
          (payload?.health ? { health: payload.health } : null)
      );
    } catch (err) {
      setError(err.message || "Could not load admin dashboard.");
      if (!background) setDashboard(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const health = dashboard?.health || {};
  const app = dashboard?.app || {};
  const shows = health?.shows || {};
  const queue = health?.queue || {};
  const news = health?.news || {};
  const notifications = health?.notifications || {};
  const devices = health?.devices || {};
  const cron = health?.cron || {};
  const reports = dashboard?.reports || [];
  const newsSources = dashboard?.news_sources || [];
  const newsRuns = dashboard?.news_runs || [];
  const cronJobs = dashboard?.cron_jobs || [];

  const warnings = useMemo(() => {
    const items = [];

    if (Number(cron.failures_24h || 0) > 0) {
      items.push({
        title: "Cron failures detected",
        detail: `${cron.failures_24h} cron run(s) failed in the past 24 hours.`,
        state: "danger",
      });
    }

    if (
      Number(news.enabled_sources || 0) > 0 &&
      hoursSince(news.last_run) > 12
    ) {
      items.push({
        title: "TV news automation looks stale",
        detail: `Last recorded news run: ${formatDate(news.last_run)}.`,
        state: "warn",
      });
    }

    if (Number(queue.failed || 0) > 0 || Number(queue.retries || 0) > 0) {
      items.push({
        title: "Show sync queue needs attention",
        detail: `${queue.failed || 0} failed and ${queue.retries || 0} retrying.`,
        state: "warn",
      });
    }

    if (Number(shows.stale_7d || 0) > 0) {
      items.push({
        title: "Very stale show data",
        detail: `${shows.stale_7d} show(s) have not synced for more than 7 days.`,
        state: "warn",
      });
    }

    return items;
  }, [
    cron.failures_24h,
    news.enabled_sources,
    news.last_run,
    queue.failed,
    queue.retries,
    shows.stale_7d,
  ]);

  if (loading) {
    return (
      <main className="admin-health-page">
        <p className="admin-health-muted">Loading BURGRS admin...</p>
      </main>
    );
  }

  if (error && !dashboard) {
    return (
      <main className="admin-health-page">
        <h1>Admin</h1>
        <p className="admin-health-error">{error}</p>
      </main>
    );
  }

  const overallState = warnings.length ? "warn" : "ok";

  return (
    <main className="admin-health-page">
      <header className="admin-health-header">
        <div>
          <span>Burgrs TV admin</span>
          <div className="admin-title-line">
            <h1>Admin</h1>
            <StatePill state={overallState}>
              {warnings.length ? "Needs attention" : "Healthy"}
            </StatePill>
          </div>
          <p>
            Site operations, automations, issue reports and data health in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load({ background: true })}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {error ? <p className="admin-health-inline-error">{error}</p> : null}

      <nav className="admin-health-tabs" aria-label="Admin sections">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeSection === key ? "is-active" : ""}
            onClick={() => setActiveSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeSection === "overview" ? (
        <>
          <section className="admin-health-grid admin-overview-grid">
            <Metric label="Users" value={app.users_total} />
            <Metric label="Active 7d" value={app.users_active_7d} />
            <Metric label="Shows" value={app.shows ?? shows.total_shows} />
            <Metric label="Episodes" value={app.episodes} />
            <Metric label="Library entries" value={app.library_entries} />
            <Metric label="Watched episodes" value={app.watched_episodes} />
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Attention</h2>
              <span>{warnings.length ? `${warnings.length} item(s)` : "All clear"}</span>
            </div>

            <div className="admin-attention-list">
              {warnings.length ? (
                warnings.map((item) => (
                  <div
                    key={item.title}
                    className={`admin-attention-item is-${item.state}`}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <StatePill state={item.state}>Check</StatePill>
                  </div>
                ))
              ) : (
                <div className="admin-attention-item is-ok">
                  <div>
                    <strong>Core systems look healthy</strong>
                    <span>No current queue, cron, news or very-stale-data warnings.</span>
                  </div>
                  <StatePill state="ok">OK</StatePill>
                </div>
              )}

              {Number(app.issue_reports_open || 0) > 0 ? (
                <button
                  type="button"
                  className="admin-attention-item admin-attention-button"
                  onClick={() => setActiveSection("issues")}
                >
                  <div>
                    <strong>Open issue reports</strong>
                    <span>{app.issue_reports_open} report(s) need review.</span>
                  </div>
                  <StatePill state="neutral">View</StatePill>
                </button>
              ) : null}
            </div>
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Operations</h2>
              <span>Live snapshot</span>
            </div>
            <div className="admin-health-detail-grid">
              <div>
                <span>Last TVDB show sync</span>
                <strong>{formatDate(shows.last_tvdb_sync)}</strong>
              </div>
              <div>
                <span>Last TMDB rating sync</span>
                <strong>{formatDate(shows.last_tmdb_rating_sync)}</strong>
              </div>
              <div>
                <span>Queue pending</span>
                <strong>{formatNumber(queue.pending)}</strong>
              </div>
              <div>
                <span>Queue failed</span>
                <strong>{formatNumber(queue.failed)}</strong>
              </div>
              <div>
                <span>Latest notification</span>
                <strong>{formatDate(notifications.last_notification)}</strong>
              </div>
              <div>
                <span>Notifications 24h</span>
                <strong>{formatNumber(notifications.created_24h)}</strong>
              </div>
              <div>
                <span>Latest news run</span>
                <strong>{formatDate(news.last_run)}</strong>
              </div>
              <div>
                <span>Active Android devices</span>
                <strong>{formatNumber(devices.active_android_devices)}</strong>
              </div>
            </div>
          </section>

          <section className="admin-health-grid admin-secondary-grid">
            <Metric label="Show ratings" value={app.show_ratings} />
            <Metric label="Episode ratings" value={app.episode_ratings} />
            <Metric label="Show reviews" value={app.show_reviews} />
            <Metric label="Creator posts" value={app.creator_posts} />
            <Metric label="Creator lists" value={app.creator_lists} />
            <Metric
              label="Open reports"
              value={app.issue_reports_open}
              state={Number(app.issue_reports_open || 0) ? "warn" : "ok"}
            />
          </section>
        </>
      ) : null}

      {activeSection === "automations" ? (
        <>
          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Scheduled jobs</h2>
              <span>{cronJobs.length} configured</span>
            </div>
            <div className="admin-health-list">
              {cronJobs.length ? (
                cronJobs.map((job) => (
                  <div key={job.jobid} className="admin-health-row">
                    <div>
                      <strong>{job.jobname || `Job ${job.jobid}`}</strong>
                      <span>{job.schedule || "No schedule"}</span>
                    </div>
                    <StatePill state={job.active ? "ok" : "neutral"}>
                      {job.active ? "Active" : "Off"}
                    </StatePill>
                  </div>
                ))
              ) : (
                <p className="admin-health-muted">No scheduled jobs found.</p>
              )}
            </div>
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>TV news sources</h2>
              <span>{formatNumber(news.enabled_sources)} enabled</span>
            </div>
            <div className="admin-health-list">
              {newsSources.length ? (
                newsSources.map((source) => (
                  <div key={source.id || source.name} className="admin-health-row">
                    <div>
                      <strong>{source.name}</strong>
                      <span>
                        Priority {source.priority ?? "--"} · Updated {formatDate(source.updated_at)}
                      </span>
                    </div>
                    <StatePill state={source.enabled ? "ok" : "neutral"}>
                      {source.enabled ? "Enabled" : "Disabled"}
                    </StatePill>
                  </div>
                ))
              ) : (
                <p className="admin-health-muted">No news sources found.</p>
              )}
            </div>
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Recent news runs</h2>
              <span>Newest first</span>
            </div>
            <div className="admin-health-list">
              {newsRuns.length ? (
                newsRuns.map((run) => {
                  const failed =
                    Number(run.error_count || 0) > 0 ||
                    !["completed", "success", "succeeded"].includes(
                      String(run.status || "").toLowerCase()
                    );

                  return (
                    <div key={run.id} className="admin-health-row admin-run-row">
                      <div>
                        <strong>{formatDate(run.started_at)}</strong>
                        <span>
                          Published {run.published_count || 0} · Rejected {run.rejected_count || 0}
                          {" · "}Errors {run.error_count || 0}
                        </span>
                        {run.message ? <em>{run.message}</em> : null}
                      </div>
                      <StatePill state={failed ? "warn" : "ok"}>
                        {run.status || "Unknown"}
                      </StatePill>
                    </div>
                  );
                })
              ) : (
                <p className="admin-health-muted">No recent news runs found.</p>
              )}
            </div>
          </section>
        </>
      ) : null}

      {activeSection === "issues" ? (
        <section className="admin-health-card">
          <div className="admin-health-section-head">
            <h2>Issue reports</h2>
            <span>{formatNumber(app.issue_reports_open)} open / reviewing</span>
          </div>

          <div className="admin-health-list">
            {reports.length ? (
              reports.map((report) => {
                const isOpen = ["open", "reviewing"].includes(report.status);
                return (
                  <article key={report.id} className="admin-report-row">
                    <div className="admin-report-head">
                      <div>
                        <strong>{report.subject || "Untitled report"}</strong>
                        <span>
                          {report.category || "other"} · {formatDate(report.created_at)}
                        </span>
                      </div>
                      <StatePill state={isOpen ? "warn" : "ok"}>
                        {report.status || "unknown"}
                      </StatePill>
                    </div>

                    {report.description ? <p>{report.description}</p> : null}
                    {report.steps_to_reproduce ? (
                      <div className="admin-report-detail">
                        <span>Steps</span>
                        <strong>{report.steps_to_reproduce}</strong>
                      </div>
                    ) : null}
                    <div className="admin-report-meta">
                      <span>{report.screenshot_count || 0} screenshot(s)</span>
                      {report.email_failed ? (
                        <span className="is-error">Report email failed</span>
                      ) : null}
                      {report.page_url ? (
                        <a href={report.page_url} target="_blank" rel="noreferrer">
                          Open reported page
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="admin-health-muted">No issue reports.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeSection === "data" ? (
        <>
          <section className="admin-health-grid">
            <Metric
              label="Stale >24h"
              value={shows.stale_24h}
              state={Number(shows.stale_24h || 0) ? "warn" : "ok"}
            />
            <Metric
              label="Stale >7d"
              value={shows.stale_7d}
              state={Number(shows.stale_7d || 0) ? "warn" : "ok"}
            />
            <Metric
              label="Queue pending"
              value={queue.pending}
              state={Number(queue.pending || 0) >= 10 ? "warn" : "ok"}
            />
            <Metric
              label="Queue failed"
              value={queue.failed}
              state={Number(queue.failed || 0) ? "warn" : "ok"}
            />
            <Metric
              label="Retries"
              value={queue.retries}
              state={Number(queue.retries || 0) >= 5 ? "warn" : "ok"}
            />
            <Metric
              label="Cron failures 24h"
              value={cron.failures_24h}
              state={Number(cron.failures_24h || 0) ? "warn" : "ok"}
            />
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Very stale shows</h2>
              <span>More than 7 days</span>
            </div>
            <div className="admin-health-list">
              {(health?.stale_shows || []).length ? (
                health.stale_shows.map((show) => (
                  <Link
                    key={show.id}
                    to={
                      show.tmdb_id
                        ? `/show/tmdb/${show.tmdb_id}`
                        : `/show/${show.tvdb_id || show.id}`
                    }
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
                <p className="admin-health-muted">No shows are more than 7 days stale.</p>
              )}
            </div>
          </section>

          <section className="admin-health-card">
            <div className="admin-health-section-head">
              <h2>Retry / failure history</h2>
              <span>Recent problem records</span>
            </div>
            <div className="admin-health-list">
              {(health?.queue_failures || []).length ? (
                health.queue_failures.map((item) => (
                  <div
                    key={`${item.show_id}-${item.updated_at}`}
                    className="admin-health-row"
                  >
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
                <p className="admin-health-muted">No retry or failure history.</p>
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
                  <div
                    key={`${item.jobid}-${item.start_time}`}
                    className="admin-health-row"
                  >
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
        </>
      ) : null}

      <p className="admin-health-generated">
        Snapshot generated {formatDate(dashboard?.generated_at || health?.generated_at)}
      </p>
    </main>
  );
}
