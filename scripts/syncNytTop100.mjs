import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or TMDB_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const shows = [
  ["Breaking Bad","Breaking Bad",2008],
  ["The Wire","The Wire",2002],
  ["Mad Men","Mad Men",2007],
  ["Succession","Succession",2018],
  ["Fleabag","Fleabag",2016],
  ["Game of Thrones","Game of Thrones",2011],
  ["Veep","Veep",2012],
  ["30 Rock","30 Rock",2006],
  ["Curb Your Enthusiasm","Curb Your Enthusiasm",2000],
  ["Atlanta","Atlanta",2016],
  ["The Office (U.S.)","The Office",2005],
  ["Arrested Development","Arrested Development",2003],
  ["Girls","Girls",2012],
  ["Friday Night Lights","Friday Night Lights",2006],
  ["Six Feet Under","Six Feet Under",2001],
  ["The Office (U.K.)","The Office",2001],
  ["The Americans","The Americans",2013],
  ["I May Destroy You","I May Destroy You",2020],
  ["Chernobyl","Chernobyl",2019],
  ["The Crown","The Crown",2016],
  ["The White Lotus","The White Lotus",2021],
  ["Lost","Lost",2004],
  ["The Comeback","The Comeback",2005],
  ["Deadwood","Deadwood",2004],
  ["The Leftovers","The Leftovers",2014],
  ["Black Mirror","Black Mirror",2011],
  ["Better Call Saul","Better Call Saul",2015],
  ["Band of Brothers","Band of Brothers",2001],
  ["Key & Peele","Key & Peele",2012],
  ["Severance","Severance",2022],
  ["Survivor","Survivor",2000],
  ["Andor","Andor",2022],
  ["Enlightened","Enlightened",2011],
  ["Schitt's Creek","Schitt's Creek",2015],
  ["True Detective (Season 1)","True Detective",2014],
  ["The Pitt","The Pitt",2025],
  ["Battlestar Galactica","Battlestar Galactica",2004],
  ["Homeland","Homeland",2011],
  ["Watchmen","Watchmen",2019],
  ["Adolescence","Adolescence",2025],
  ["Louie","Louie",2010],
  ["Hacks","Hacks",2021],
  ["Peaky Blinders","Peaky Blinders",2013],
  ["BoJack Horseman","BoJack Horseman",2014],
  ["Happy Valley","Happy Valley",2014],
  ["Broad City","Broad City",2014],
  ["Twin Peaks: The Return","Twin Peaks",null],
  ["House of Cards","House of Cards",2013],
  ["Normal People","Normal People",2020],
  ["Parks and Recreation","Parks and Recreation",2009],
  ["The Good Place","The Good Place",2016],
  ["Downton Abbey","Downton Abbey",2010],
  ["Stranger Things","Stranger Things",2016],
  ["The Bureau","The Bureau",2015],
  ["Insecure","Insecure",2016],
  ["Nathan for You","Nathan for You",2013],
  ["I Think You Should Leave with Tim Robinson","I Think You Should Leave with Tim Robinson",2019],
  ["Chappelle's Show","Chappelle's Show",2003],
  ["PEN15","PEN15",2019],
  ["Peep Show","Peep Show",2003],
  ["RuPaul's Drag Race","RuPaul's Drag Race",2009],
  ["Slow Horses","Slow Horses",2022],
  ["The Thick of It","The Thick of It",2005],
  ["Anthony Bourdain: Parts Unknown","Anthony Bourdain: Parts Unknown",2013],
  ["Mare of Easttown","Mare of Easttown",2021],
  ["The Rehearsal","The Rehearsal",2022],
  ["The Handmaid's Tale","The Handmaid's Tale",2017],
  ["Ozark","Ozark",2017],
  ["Anthony Bourdain: No Reservations","Anthony Bourdain: No Reservations",2005],
  ["The Shield","The Shield",2002],
  ["Beef","BEEF",2023],
  ["Squid Game","Squid Game",2021],
  ["Barry","Barry",2018],
  ["The Bear","The Bear",2022],
  ["Ted Lasso","Ted Lasso",2020],
  ["Somebody Somewhere","Somebody Somewhere",2022],
  ["Modern Family","Modern Family",2009],
  ["It's Always Sunny in Philadelphia","It's Always Sunny in Philadelphia",2005],
  ["The Good Wife","The Good Wife",2009],
  ["How To with John Wilson","How To with John Wilson",2020],
  ["The Queen's Gambit","The Queen's Gambit",2020],
  ["Better Things","Better Things",2016],
  ["Justified","Justified",2010],
  ["Planet Earth","Planet Earth",2006],
  ["The Great British Baking Show","The Great British Bake Off",2010],
  ["Shōgun","Shōgun",2024],
  ["Reservation Dogs","Reservation Dogs",2021],
  ["Dexter","Dexter",2006],
  ["Baby Reindeer","Baby Reindeer",2024],
  ["Eastbound & Down","Eastbound & Down",2009],
  ["Catastrophe","Catastrophe",2015],
  ["The Night Of","The Night Of",2016],
  ["Station Eleven","Station Eleven",2021],
  ["The Diplomat","The Diplomat",2023],
  ["House","House",2004],
  ["Halt and Catch Fire","Halt and Catch Fire",2014],
  ["Community","Community",2009],
  ["The OA","The OA",2016],
  ["Gilmore Girls","Gilmore Girls",2000],
  ["Scandal","Scandal",2012],
].map(([label, query, year]) => ({ label, query, year }));

const normalize = (value = "") =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${path} failed with ${res.status}`);
  return res.json();
}

async function resolveTmdb(spec) {
  const data = await tmdb("/search/tv", {
    query: spec.query,
    first_air_date_year: spec.year || undefined,
  });
  const results = data.results || [];
  if (!results.length) return null;
  const wanted = normalize(spec.query);
  return results.find((r) => normalize(r.name) === wanted || normalize(r.original_name) === wanted) || results[0];
}

async function getAllShows() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("shows")
      .select("id,name,original_name,tmdb_id,tvdb_id,first_aired")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function findExisting(dbShows, spec, resolved) {
  if (resolved?.id) {
    const byTmdb = dbShows.find((s) => Number(s.tmdb_id) === Number(resolved.id));
    if (byTmdb) return byTmdb;
  }

  const candidates = new Set([normalize(spec.label), normalize(spec.query)]);
  return dbShows.find((s) => {
    const name = normalize(s.name);
    const original = normalize(s.original_name || "");
    if (!candidates.has(name) && !candidates.has(original)) return false;
    if (!spec.year) return true;
    const year = Number(String(s.first_aired || "").slice(0, 4));
    return !year || year === spec.year;
  }) || null;
}

async function insertShowAndEpisodes(spec, resolved) {
  const fullShow = await tmdb(`/tv/${resolved.id}`, { append_to_response: "external_ids" });
  const tvdbId = fullShow.external_ids?.tvdb_id || null;

  const { data: insertedShow, error: showInsertError } = await supabase
    .from("shows")
    .insert({
      tvdb_id: tvdbId,
      tmdb_id: resolved.id,
      name: fullShow.name || resolved.name || spec.query,
      original_name: fullShow.original_name || null,
      overview: fullShow.overview || "",
      status: fullShow.status || null,
      original_country: Array.isArray(fullShow.origin_country) ? fullShow.origin_country[0] || null : null,
      original_language: fullShow.original_language || null,
      first_aired: fullShow.first_air_date || null,
      last_aired: fullShow.last_air_date || null,
      runtime_minutes: Array.isArray(fullShow.episode_run_time) ? fullShow.episode_run_time[0] || null : null,
      network: fullShow.networks?.[0]?.name || null,
      genres: Array.isArray(fullShow.genres) ? fullShow.genres.map((g) => g.name).filter(Boolean) : [],
      poster_url: fullShow.poster_path ? `https://image.tmdb.org/t/p/w500${fullShow.poster_path}` : null,
      backdrop_url: fullShow.backdrop_path ? `https://image.tmdb.org/t/p/original${fullShow.backdrop_path}` : null,
      external_ids: {
        tmdb_id: resolved.id,
        tvdb_id: tvdbId,
        imdb_id: fullShow.external_ids?.imdb_id || null,
      },
      rating_average: fullShow.vote_average || null,
      rating_count: fullShow.vote_count || null,
      last_synced_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id,name,tmdb_id,tvdb_id")
    .single();

  if (showInsertError) throw showInsertError;

  let seasonsImported = 0;
  let episodesImported = 0;

  for (const season of fullShow.seasons || []) {
    const seasonNumber = Number(season.season_number);
    if (!seasonNumber || seasonNumber === 0) continue;

    const { data: insertedSeason, error: seasonInsertError } = await supabase
      .from("seasons")
      .insert({
        show_id: insertedShow.id,
        season_number: seasonNumber,
        season_type: "official",
        name: season.name || `Season ${seasonNumber}`,
        overview: season.overview || "",
        image_url: season.poster_path ? `https://image.tmdb.org/t/p/w500${season.poster_path}` : null,
        episode_count: season.episode_count || null,
        aired_from: season.air_date || null,
        last_synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (seasonInsertError) throw seasonInsertError;
    seasonsImported += 1;

    const seasonData = await tmdb(`/tv/${resolved.id}/season/${seasonNumber}`);
    const episodes = (seasonData.episodes || [])
      .filter((ep) => Number(ep.episode_number) > 0)
      .map((ep) => ({
        show_id: insertedShow.id,
        season_id: insertedSeason.id,
        season_type: "official",
        season_number: seasonNumber,
        episode_number: Number(ep.episode_number),
        name: ep.name || `Episode ${ep.episode_number}`,
        overview: ep.overview || "",
        aired_date: ep.air_date || null,
        aired_at: ep.air_date || null,
        image_url: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
        is_special: false,
        external_ids: { tmdb_id: ep.id },
        tmdb_vote_average: ep.vote_average || null,
        tmdb_vote_count: ep.vote_count || null,
        tmdb_still_path: ep.still_path || null,
        last_synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

    if (episodes.length) {
      const { error: episodeInsertError } = await supabase.from("episodes").insert(episodes);
      if (episodeInsertError) throw episodeInsertError;
      episodesImported += episodes.length;
    }
  }

  return {
    ...insertedShow,
    seasons_imported: seasonsImported,
    episodes_imported: episodesImported,
  };
}

const report = {
  source: "The New York Times — The 100 Best TV Shows of the 21st Century (2026)",
  total_requested: shows.length,
  started_at: new Date().toISOString(),
  existing_before: [],
  inserted: [],
  errors: [],
  missing_after: [],
};

let dbShows = await getAllShows();

for (const spec of shows) {
  try {
    const resolved = await resolveTmdb(spec);
    if (!resolved) {
      report.errors.push({ title: spec.label, error: "TMDB search returned no match" });
      continue;
    }

    const existing = findExisting(dbShows, spec, resolved);
    if (existing) {
      report.existing_before.push({
        title: spec.label,
        matched_name: existing.name,
        tmdb_id: existing.tmdb_id,
        tvdb_id: existing.tvdb_id,
      });
      continue;
    }

    const inserted = await insertShowAndEpisodes(spec, resolved);
    report.inserted.push({
      title: spec.label,
      matched_name: inserted.name,
      tmdb_id: inserted.tmdb_id,
      tvdb_id: inserted.tvdb_id,
      seasons_imported: inserted.seasons_imported,
      episodes_imported: inserted.episodes_imported,
    });
    dbShows.push(inserted);
  } catch (error) {
    report.errors.push({ title: spec.label, error: error?.message || String(error) });
  }
}

const finalShows = await getAllShows();
for (const spec of shows) {
  try {
    const resolved = await resolveTmdb(spec);
    if (!findExisting(finalShows, spec, resolved)) report.missing_after.push(spec.label);
  } catch {
    report.missing_after.push(spec.label);
  }
}

report.existing_before_count = report.existing_before.length;
report.inserted_count = report.inserted.length;
report.error_count = report.errors.length;
report.verified_count = shows.length - report.missing_after.length;
report.completed_at = new Date().toISOString();

await fs.mkdir("public", { recursive: true });
await fs.writeFile("public/nyt-top100-sync-report.json", JSON.stringify(report, null, 2));

console.log(
  `NYT Top 100 sync complete: ${report.verified_count}/${report.total_requested} verified, ${report.inserted_count} inserted, ${report.error_count} errors.`
);
if (report.missing_after.length) {
  console.log("Missing after sync:", report.missing_after.join(", "));
}
