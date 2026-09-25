const { createClient } = require("@supabase/supabase-js");

const shows = [
  ["Breaking Bad","Breaking Bad",2008],["The Wire","The Wire",2002],["Mad Men","Mad Men",2007],["Succession","Succession",2018],["Fleabag","Fleabag",2016],["Game of Thrones","Game of Thrones",2011],["Veep","Veep",2012],["30 Rock","30 Rock",2006],["Curb Your Enthusiasm","Curb Your Enthusiasm",2000],["Atlanta","Atlanta",2016],["The Office (U.S.)","The Office",2005],["Arrested Development","Arrested Development",2003],["Girls","Girls",2012],["Friday Night Lights","Friday Night Lights",2006],["Six Feet Under","Six Feet Under",2001],["The Office (U.K.)","The Office",2001],["The Americans","The Americans",2013],["I May Destroy You","I May Destroy You",2020],["Chernobyl","Chernobyl",2019],["The Crown","The Crown",2016],
  ["The White Lotus","The White Lotus",2021],["Lost","Lost",2004],["The Comeback","The Comeback",2005],["Deadwood","Deadwood",2004],["The Leftovers","The Leftovers",2014],["Black Mirror","Black Mirror",2011],["Better Call Saul","Better Call Saul",2015],["Band of Brothers","Band of Brothers",2001],["Key & Peele","Key & Peele",2012],["Severance","Severance",2022],["Survivor","Survivor",2000],["Andor","Andor",2022],["Enlightened","Enlightened",2011],["Schitt's Creek","Schitt's Creek",2015],["True Detective (Season 1)","True Detective",2014],["The Pitt","The Pitt",2025],["Battlestar Galactica","Battlestar Galactica",2004],["Homeland","Homeland",2011],["Watchmen","Watchmen",2019],["Adolescence","Adolescence",2025],
  ["Louie","Louie",2010],["Hacks","Hacks",2021],["Peaky Blinders","Peaky Blinders",2013],["BoJack Horseman","BoJack Horseman",2014],["Happy Valley","Happy Valley",2014],["Broad City","Broad City",2014],["Twin Peaks: The Return","Twin Peaks",null],["House of Cards","House of Cards",2013],["Normal People","Normal People",2020],["Parks and Recreation","Parks and Recreation",2009],["The Good Place","The Good Place",2016],["Downton Abbey","Downton Abbey",2010],["Stranger Things","Stranger Things",2016],["The Bureau","The Bureau",2015],["Insecure","Insecure",2016],["Nathan for You","Nathan for You",2013],["I Think You Should Leave with Tim Robinson","I Think You Should Leave with Tim Robinson",2019],["Chappelle's Show","Chappelle's Show",2003],["PEN15","PEN15",2019],["Peep Show","Peep Show",2003],
  ["RuPaul's Drag Race","RuPaul's Drag Race",2009],["Slow Horses","Slow Horses",2022],["The Thick of It","The Thick of It",2005],["Anthony Bourdain: Parts Unknown","Anthony Bourdain: Parts Unknown",2013],["Mare of Easttown","Mare of Easttown",2021],["The Rehearsal","The Rehearsal",2022],["The Handmaid's Tale","The Handmaid's Tale",2017],["Ozark","Ozark",2017],["Anthony Bourdain: No Reservations","Anthony Bourdain: No Reservations",2005],["The Shield","The Shield",2002],["Beef","BEEF",2023],["Squid Game","Squid Game",2021],["Barry","Barry",2018],["The Bear","The Bear",2022],["Ted Lasso","Ted Lasso",2020],["Somebody Somewhere","Somebody Somewhere",2022],["Modern Family","Modern Family",2009],["It's Always Sunny in Philadelphia","It's Always Sunny in Philadelphia",2005],["The Good Wife","The Good Wife",2009],["How To with John Wilson","How To with John Wilson",2020],
  ["The Queen's Gambit","The Queen's Gambit",2020],["Better Things","Better Things",2016],["Justified","Justified",2010],["Planet Earth","Planet Earth",2006],["The Great British Baking Show","The Great British Bake Off",2010],["Shōgun","Shōgun",2024],["Reservation Dogs","Reservation Dogs",2021],["Dexter","Dexter",2006],["Baby Reindeer","Baby Reindeer",2024],["Eastbound & Down","Eastbound & Down",2009],["Catastrophe","Catastrophe",2015],["The Night Of","The Night Of",2016],["Station Eleven","Station Eleven",2021],["The Diplomat","The Diplomat",2023],["House","House",2004],["Halt and Catch Fire","Halt and Catch Fire",2014],["Community","Community",2009],["The OA","The OA",2016],["Gilmore Girls","Gilmore Girls",2000],["Scandal","Scandal",2012],
].map(([label, query, year]) => ({ label, query, year }));

const normalize = (value = "") =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

async function getAllShows(supabase) {
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

exports.handler = async () => {
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase environment is not configured");

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const dbShows = await getAllShows(supabase);
    const matched = [];
    const missing = [];

    for (const spec of shows) {
      const candidates = new Set([normalize(spec.label), normalize(spec.query)]);
      const row = dbShows.find((s) => {
        const nameMatch = candidates.has(normalize(s.name)) || candidates.has(normalize(s.original_name || ""));
        if (!nameMatch) return false;
        if (!spec.year) return true;
        const year = Number(String(s.first_aired || "").slice(0, 4));
        return !year || year === spec.year;
      });

      if (!row) {
        missing.push(spec.label);
      } else {
        matched.push({
          title: spec.label,
          name: row.name,
          first_aired: row.first_aired,
          tmdb_id: row.tmdb_id,
          tvdb_id: row.tvdb_id,
        });
      }
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({
        total_expected: shows.length,
        verified_count: matched.length,
        missing_count: missing.length,
        missing,
        matched,
        audited_at: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: error?.message || String(error) }),
    };
  }
};
