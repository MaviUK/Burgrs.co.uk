from pathlib import Path

creator_path = Path("src/pages/CreatorProfile.jsx")
creator = creator_path.read_text()
css_path = Path("src/pages/CreatorProfileStats.css")
css = css_path.read_text()


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Could not find {label}")
    return text.replace(old, new, 1)


creator = replace_once(
    creator,
    '  creator_tagline: "Every show. Every episode. Always complete.",\n',
    '  creator_tagline: "Every show. Every episode. Every creator.",\n',
    "system tagline",
)
creator = replace_once(
    creator,
    '  bio: "The official BURGRS system profile. It automatically includes every show in the database and treats every episode as watched.",\n',
    '  bio: "The official BURGRS system profile. It automatically includes every show in the database, treats every episode as watched, and follows every creator.",\n',
    "system bio",
)
creator = replace_once(
    creator,
    '  creator_bio: "This profile is generated directly from the BURGRS database, so new shows and episodes appear here automatically without needing manual updates.",\n',
    '  creator_bio: "This profile is generated directly from the BURGRS database, so new shows, episodes and creator profiles appear here automatically without needing manual updates.",\n',
    "system creator bio",
)

anchor = '''  async function loadSystemAdminProfile() {\n'''
helper = '''  async function fetchAllSystemCreators() {\n    const rows = [];\n    let from = 0;\n\n    while (true) {\n      const { data, error: profilesError } = await supabase\n        .from("profiles")\n        .select("id, username, full_name, display_name, avatar_url")\n        .not("username", "is", null)\n        .order("username", { ascending: true })\n        .range(from, from + SYSTEM_SHOW_PAGE_SIZE - 1);\n\n      if (profilesError) throw profilesError;\n\n      const page = data || [];\n      rows.push(\n        ...page.filter((profileRow) => String(profileRow?.username || "").trim())\n      );\n      if (page.length < SYSTEM_SHOW_PAGE_SIZE) break;\n      from += SYSTEM_SHOW_PAGE_SIZE;\n    }\n\n    return rows;\n  }\n\n'''
creator = replace_once(creator, anchor, helper + anchor, "system creator loader")

creator = replace_once(
    creator,
    '''    const [showRows, episodeResult] = await Promise.all([\n      fetchAllSystemShows(),\n      supabase.from("episodes").select("id", { count: "exact", head: true }),\n    ]);\n''',
    '''    const [showRows, creatorRows, episodeResult] = await Promise.all([\n      fetchAllSystemShows(),\n      fetchAllSystemCreators(),\n      supabase.from("episodes").select("id", { count: "exact", head: true }),\n    ]);\n''',
    "system profile parallel load",
)
creator = replace_once(
    creator,
    '''    const episodeCount = Number(episodeResult.count || 0);\n    setSystemStats({ shows: showRows.length, episodes: episodeCount });\n''',
    '''    const episodeCount = Number(episodeResult.count || 0);\n    setSystemStats({ shows: showRows.length, episodes: episodeCount });\n    setFollowing(creatorRows);\n    setFollowingCount(creatorRows.length);\n''',
    "system creator following state",
)
creator = replace_once(
    creator,
    '          "This system collection mirrors the BURGRS database automatically. Every show currently in the database is included, every episode is treated as watched, and future additions appear without manual maintenance.",\n',
    '          "This system collection mirrors the BURGRS database automatically. Every show currently in the database is included, every episode is treated as watched, every creator is followed, and future additions appear without manual maintenance.",\n',
    "system collection description",
)

stats_anchor = '''        >\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>{systemStats.shows.toLocaleString("en-GB")}</strong>\n            <span>Shows</span>\n          </button>\n'''
stats_replacement = '''        >\n          <button\n            type="button"\n            className={getStatButtonClass("following")}\n            onClick={() => setActiveProfilePanel("following")}\n          >\n            <strong>{followingCount.toLocaleString("en-GB")}</strong>\n            <span>Creators followed</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>{systemStats.shows.toLocaleString("en-GB")}</strong>\n            <span>Shows</span>\n          </button>\n'''
creator = replace_once(creator, stats_anchor, stats_replacement, "system creator stat")

creator = replace_once(
    creator,
    '''        {activeProfilePanel === "following" ? (\n          <>\n            <div className="creator-section-head">\n              <h2>Following</h2>\n            </div>\n            <ProfileList profiles={following} emptyText="Not following anyone yet." />\n          </>\n        ) : null}\n''',
    '''        {activeProfilePanel === "following" ? (\n          <>\n            <div className="creator-section-head">\n              <h2>{isSystemProfile ? "Creators followed" : "Following"}</h2>\n            </div>\n            <ProfileList\n              profiles={following}\n              emptyText={isSystemProfile ? "No creator profiles found." : "Not following anyone yet."}\n            />\n          </>\n        ) : null}\n''',
    "following panel copy",
)

css = replace_once(
    css,
    '  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;\n',
    '  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;\n',
    "system stats columns",
)

creator_path.write_text(creator)
css_path.write_text(css)
