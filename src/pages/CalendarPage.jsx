import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/date";
import "./CalendarPage.css";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatGroupLabel(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getEpisodeCode(ep) {
  return `S${String(ep.seasonNumber).padStart(2, "0")}E${String(
    ep.number
  ).padStart(2, "0")}`;
}

function isFirstEpisode(ep) {
  return Number(ep?.seasonNumber) === 1 && Number(ep?.episodeNumber) === 1;
}

function normalizeStatus(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function isArchivedStatus(value) {
  const status = normalizeStatus(value);
  return status === "archived" || status === "archive";
}

function isWatchlistStatus(value) {
  const status = normalizeStatus(value);
  return status === "watchlist" || status === "plan_to_watch";
}

export default function CalendarPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [range, setRange] = useState("week");

  useEffect(() => {
    async function loadCalendar() {
      setLoading(true);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setItems([]);
          return;
        }

        const { data: watchedRows, error: watchedError } = await supabase
          .from("watched_episodes")
          .select("episode_id")
          .eq("user_id", user.id);

        if (watchedError) throw watchedError;

        const watchedEpisodeIds = new Set(
          (watchedRows || [])
            .map((row) => row.episode_id)
            .filter(Boolean)
            .map(String)
        );

        const { data: userShows, error: showsError } = await supabase
          .from("user_shows_new")
          .select(`
            id,
            user_id,
            show_id,
            watch_status,
            added_at,
            created_at,
            shows!inner(
              id,
              tvdb_id,
              name,
              poster_url
            )
          `)
          .eq("user_id", user.id)
          .order("added_at", { ascending: true });

        if (showsError) throw showsError;

        const safeShows = (userShows || [])
          .filter((row) => !isArchivedStatus(row.watch_status))
          .map((row) => ({
            show_id: row.show_id,
            tvdb_id: row.shows.tvdb_id,
            show_name: row.shows.name || "Unknown title",
            poster_url: row.shows.poster_url || null,
            watch_status: row.watch_status || null,
          }));

        const showIds = safeShows.map((show) => show.show_id).filter(Boolean);
        const showLookup = {};

        for (const show of safeShows) {
          showLookup[show.show_id] = show;
        }

        if (showIds.length === 0) {
          setItems([]);
          return;
        }

        const today = startOfToday();

        const { data: episodeRows, error: episodesError } = await supabase
          .from("episodes")
          .select(`
            id,
            show_id,
            name,
            season_number,
            episode_number,
            aired_date
          `)
          .in("show_id", showIds)
          .gte("aired_date", today.toISOString().slice(0, 10))
          .order("aired_date", { ascending: true })
          .order("season_number", { ascending: true })
          .order("episode_number", { ascending: true });

        if (episodesError) throw episodesError;

        const episodesByShow = {};

        for (const row of episodeRows || []) {
          if (watchedEpisodeIds.has(String(row.id))) continue;

          const show = showLookup[row.show_id];
          if (!show) continue;

          const airValue = row.aired_date;
          if (!airValue) continue;

          const airDate = new Date(airValue);
          if (Number.isNaN(airDate.getTime())) continue;

          const airDay = new Date(airDate);
          airDay.setHours(0, 0, 0, 0);

          if (airDay < today) continue;

          if (!episodesByShow[row.show_id]) {
            episodesByShow[row.show_id] = [];
          }

          episodesByShow[row.show_id].push({
            showId: row.show_id,
            showTvdbId: String(show.tvdb_id),
            showName: show.show_name,
            posterUrl: show.poster_url,
            watchStatus: show.watch_status,
            episodeId: row.id,
            episodeName: row.name,
            seasonNumber: row.season_number,
            episodeNumber: row.episode_number,
            aired: row.aired_date,
          });
        }

        const collected = [];

        Object.values(episodesByShow).forEach((showEpisodes) => {
          if (!showEpisodes.length) return;

          const firstUpcomingEpisode = showEpisodes[0];
          const status = normalizeStatus(firstUpcomingEpisode.watchStatus);

          if (isArchivedStatus(status)) return;

          if (isWatchlistStatus(status)) {
            if (!isFirstEpisode(firstUpcomingEpisode)) return;
          }

          collected.push(...showEpisodes);
        });

        collected.sort((a, b) => new Date(a.aired) - new Date(b.aired));
        setItems(collected);
      } catch (error) {
        console.error("Failed loading calendar:", error);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    loadCalendar();
  }, []);

  const filteredItems = useMemo(() => {
    const today = startOfToday();
    const end = new Date(today);

    if (range === "today") {
      end.setDate(today.getDate() + 1);
    } else if (range === "week") {
      end.setDate(today.getDate() + 7);
    } else if (range === "month") {
      end.setMonth(today.getMonth() + 1);
    }

    if (range === "all") return items;

    return items.filter((item) => {
      const d = new Date(item.aired);
      return d >= today && d < end;
    });
  }, [items, range]);

  const groupedItems = useMemo(() => {
    const groups = {};

    filteredItems.forEach((item) => {
      const key = new Date(item.aired).toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    return Object.entries(groups)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, episodes]) => ({
        date,
        label: formatGroupLabel(date),
        episodes,
      }));
  }, [filteredItems]);

  const rangeButtons = [
    ["today", "⌂", "Today"],
    ["week", "◷", "This Week"],
    ["month", "▦", "This Month"],
    ["all", "📅", "All Upcoming"],
  ];

  const filterButtonStyle = (active) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 999,
    border: active
      ? "1px solid rgba(151,7,71,0.72)"
      : "1px solid rgba(255,255,255,0.08)",
    background: active
      ? "rgba(151,7,71,0.32)"
      : "rgba(255,255,255,0.05)",
    color: active ? "#ffffff" : "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1,
    cursor: "pointer",
    opacity: active ? 1 : 0.82,
    whiteSpace: "nowrap",
  });

  if (loading) {
    return (
      <div className="calendar-page">
        <div className="calendar-shell">
          <div className="calendar-header">
            <h1>Calendar</h1>
            <p>Loading upcoming episodes...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="calendar-page">
      <div className="calendar-shell">
        <div className="calendar-header">
          <h1>Calendar</h1>
          <p>Upcoming episodes from your saved shows.</p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 18,
            marginBottom: 14,
            paddingTop: 0,
          }}
        >
          {rangeButtons.map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              style={filterButtonStyle(range === value)}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {groupedItems.length === 0 ? (
          <div className="calendar-empty">
            <p>No upcoming episodes in this range.</p>
          </div>
        ) : (
          <div className="calendar-groups">
            {groupedItems.map((group) => (
              <section key={group.date} className="calendar-group-card">
                <div className="calendar-group-header">
                  <h2>{group.label}</h2>
                </div>

                <div className="calendar-list">
                  {group.episodes.map((item) => (
                    <Link
                      key={`${item.showTvdbId}-${item.episodeId}`}
                      to={`/my-shows/${item.showTvdbId}?episode=${item.episodeId}`}
                      className="calendar-item"
                    >
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={item.showName}
                          className="calendar-poster"
                        />
                      ) : (
                        <div className="calendar-poster calendar-poster-fallback" />
                      )}

                      <div className="calendar-main">
                        <strong className="calendar-show-name">{item.showName}</strong>

                        <span className="calendar-episode-line">
                          {getEpisodeCode({
                            seasonNumber: item.seasonNumber,
                            number: item.episodeNumber,
                          })}{" "}
                          - {item.episodeName || "Untitled episode"}
                        </span>

                        <small className="calendar-air-date">Airs: {formatDate(item.aired)}</small>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
