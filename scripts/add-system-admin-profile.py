from pathlib import Path

creator_path = Path("src/pages/CreatorProfile.jsx")
creator = creator_path.read_text()


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Could not find {label}")
    return text.replace(old, new, 1)

creator = replace_once(
    creator,
    'import "./CreatorProfileStats.css";\n',
    '''import "./CreatorProfileStats.css";\n\nconst SYSTEM_ADMIN_USERNAME = "burgrs";\nconst SYSTEM_ADMIN_ALIASES = new Set([SYSTEM_ADMIN_USERNAME, "admin"]);\nconst SYSTEM_ADMIN_PROFILE = Object.freeze({\n  id: "burgrs-system-admin",\n  username: SYSTEM_ADMIN_USERNAME,\n  display_name: "BURGRS Admin",\n  full_name: "BURGRS Admin",\n  avatar_url: "",\n  cover_url: "",\n  bio: "The official BURGRS system profile. It automatically includes every show in the database and treats every episode as watched.",\n  creator_tagline: "Every show. Every episode. Always complete.",\n  creator_niche: "Official system profile",\n  creator_bio: "This profile is generated directly from the BURGRS database, so new shows and episodes appear here automatically without needing manual updates.",\n  is_system_profile: true,\n});\nconst SYSTEM_SHOW_PAGE_SIZE = 500;\n\nfunction isSystemAdminSlug(value) {\n  return SYSTEM_ADMIN_ALIASES.has(String(value || "").trim().toLowerCase());\n}\n''',
    "CreatorProfile imports",
)

creator = creator.replace(
    '<img src={item.poster_url} alt="" />',
    '<img src={item.poster_url} alt="" loading="lazy" />',
    1,
)

creator = replace_once(
    creator,
    '  const [rankedTopShows, setRankedTopShows] = useState([]);\n',
    '  const [rankedTopShows, setRankedTopShows] = useState([]);\n  const [systemStats, setSystemStats] = useState({ shows: 0, episodes: 0 });\n',
    "system stats state",
)

helper_anchor = '''  function toggleListExpanded(listId) {\n    setExpandedListIds((current) => {\n      const next = new Set(current);\n      if (next.has(listId)) next.delete(listId);\n      else next.add(listId);\n      return next;\n    });\n  }\n'''
helper_block = helper_anchor + '''\n  async function fetchAllSystemShows() {\n    const rows = [];\n    let from = 0;\n\n    while (true) {\n      const { data, error: showsError } = await supabase\n        .from("shows")\n        .select("id, tvdb_id, tmdb_id, name, first_aired, poster_url")\n        .order("name", { ascending: true })\n        .range(from, from + SYSTEM_SHOW_PAGE_SIZE - 1);\n\n      if (showsError) throw showsError;\n\n      const page = data || [];\n      rows.push(...page);\n      if (page.length < SYSTEM_SHOW_PAGE_SIZE) break;\n      from += SYSTEM_SHOW_PAGE_SIZE;\n    }\n\n    return rows;\n  }\n\n  async function loadSystemAdminProfile() {\n    setProfile(SYSTEM_ADMIN_PROFILE);\n    setFollowersCount(0);\n    setFollowingCount(0);\n    setFollowers([]);\n    setFollowing([]);\n    setIsFollowing(false);\n    setMonetization(null);\n    setSubscription(null);\n    setPosts([]);\n    setReviews([]);\n    setRankedTopShows([]);\n\n    const [showRows, episodeResult] = await Promise.all([\n      fetchAllSystemShows(),\n      supabase.from("episodes").select("id", { count: "exact", head: true }),\n    ]);\n\n    if (episodeResult.error) throw episodeResult.error;\n\n    const episodeCount = Number(episodeResult.count || 0);\n    setSystemStats({ shows: showRows.length, episodes: episodeCount });\n\n    const items = showRows.map((show, index) => ({\n      id: `system-${show.id}`,\n      show_id: show.id,\n      rank: index + 1,\n      show_name: show.name || "Untitled show",\n      show_year: getShowYear(show),\n      poster_url: show.poster_url || "",\n      tmdb_id: show.tmdb_id || "",\n      tvdb_id: show.tvdb_id || "",\n      note: "Watched • Complete",\n    }));\n\n    setLists([\n      {\n        id: "system-all-shows",\n        title: "Every show on BURGRS",\n        subtitle: `${showRows.length.toLocaleString("en-GB")} shows • ${episodeCount.toLocaleString("en-GB")} episodes watched`,\n        badge: "Auto",\n        description:\n          "This system collection mirrors the BURGRS database automatically. Every show currently in the database is included, every episode is treated as watched, and future additions appear without manual maintenance.",\n        visibility: "public",\n        created_at: null,\n        items,\n      },\n    ]);\n  }\n'''
creator = replace_once(creator, helper_anchor, helper_block, "system profile helpers")

creator = replace_once(
    creator,
    '      const cleanUsername = decodeURIComponent(username || "").replace(/^@/, "");\n      const profileSelect = `\n',
    '''      const cleanUsername = decodeURIComponent(username || "").replace(/^@/, "");\n\n      if (isSystemAdminSlug(cleanUsername)) {\n        await loadSystemAdminProfile();\n        return;\n      }\n\n      const profileSelect = `\n''',
    "system profile route branch",
)

creator = replace_once(
    creator,
    '  const displayName = getName(profile);\n',
    '  const isSystemProfile = Boolean(profile?.is_system_profile);\n  const displayName = getName(profile);\n',
    "system profile render flag",
)

old_actions = '''          <div className="creator-actions">\n            {isOwnProfile ? (\n              <>\n                <Link to="/profile/edit" className="creator-btn creator-btn-secondary">\n                  Edit profile\n                </Link>\n                <Link to="/creator/posts/new" className="creator-btn creator-btn-primary">\n                  Create post\n                </Link>\n                <Link to="/creator/lists/new" className="creator-btn creator-btn-secondary">\n                  Create list\n                </Link>\n              </>\n            ) : (\n              <button\n                type="button"\n                className={`creator-btn ${isFollowing ? "creator-btn-secondary" : "creator-btn-primary"}`}\n                onClick={toggleFollow}\n                disabled={followLoading}\n              >\n                {followLoading ? "Saving..." : isFollowing ? "Following" : "Follow"}\n              </button>\n            )}\n\n            {!isOwnProfile ? (\n              isSubscribed ? (\n                <button type="button" className="creator-btn creator-btn-secondary" disabled>\n                  Subscribed\n                </button>\n              ) : canSubscribe ? (\n                <button\n                  type="button"\n                  className="creator-btn creator-btn-primary"\n                  onClick={handleSubscribe}\n                  disabled={subscriptionLoading}\n                >\n                  Subscribe £{(monetization.monthly_price_pence / 100).toFixed(2)}/month\n                </button>\n              ) : (\n                <button type="button" className="creator-btn creator-btn-locked" disabled>\n                  Subscribe soon\n                </button>\n              )\n            ) : null}\n          </div>\n'''
new_actions = '''          <div className="creator-actions">\n            {isSystemProfile ? (\n              <span className="creator-btn creator-btn-secondary" aria-label="Official BURGRS system profile">\n                Official BURGRS profile\n              </span>\n            ) : isOwnProfile ? (\n              <>\n                <Link to="/profile/edit" className="creator-btn creator-btn-secondary">\n                  Edit profile\n                </Link>\n                <Link to="/creator/posts/new" className="creator-btn creator-btn-primary">\n                  Create post\n                </Link>\n                <Link to="/creator/lists/new" className="creator-btn creator-btn-secondary">\n                  Create list\n                </Link>\n              </>\n            ) : (\n              <button\n                type="button"\n                className={`creator-btn ${isFollowing ? "creator-btn-secondary" : "creator-btn-primary"}`}\n                onClick={toggleFollow}\n                disabled={followLoading}\n              >\n                {followLoading ? "Saving..." : isFollowing ? "Following" : "Follow"}\n              </button>\n            )}\n\n            {!isOwnProfile && !isSystemProfile ? (\n              isSubscribed ? (\n                <button type="button" className="creator-btn creator-btn-secondary" disabled>\n                  Subscribed\n                </button>\n              ) : canSubscribe ? (\n                <button\n                  type="button"\n                  className="creator-btn creator-btn-primary"\n                  onClick={handleSubscribe}\n                  disabled={subscriptionLoading}\n                >\n                  Subscribe £{(monetization.monthly_price_pence / 100).toFixed(2)}/month\n                </button>\n              ) : (\n                <button type="button" className="creator-btn creator-btn-locked" disabled>\n                  Subscribe soon\n                </button>\n              )\n            ) : null}\n          </div>\n'''
creator = replace_once(creator, old_actions, new_actions, "creator actions")

old_stats = '''      <section className="creator-stats-card creator-stats-card-clickable" aria-label="Creator profile sections">\n        <button\n          type="button"\n          className={getStatButtonClass("followers")}\n          onClick={() => setActiveProfilePanel("followers")}\n        >\n          <strong>{followersCount}</strong>\n          <span>Followers</span>\n        </button>\n        <button\n          type="button"\n          className={getStatButtonClass("following")}\n          onClick={() => setActiveProfilePanel("following")}\n        >\n          <strong>{followingCount}</strong>\n          <span>Following</span>\n        </button>\n        <button\n          type="button"\n          className={getStatButtonClass("posts")}\n          onClick={() => setActiveProfilePanel("posts")}\n        >\n          <strong>{posts.length}</strong>\n          <span>Posts</span>\n        </button>\n        <button\n          type="button"\n          className={getStatButtonClass("lists")}\n          onClick={() => setActiveProfilePanel("lists")}\n        >\n          <strong>{listCount}</strong>\n          <span>Lists</span>\n        </button>\n        <button\n          type="button"\n          className={getStatButtonClass("reviews")}\n          onClick={() => setActiveProfilePanel("reviews")}\n        >\n          <strong>{reviews.length}</strong>\n          <span>Reviews</span>\n        </button>\n      </section>\n'''
new_stats = '''      {isSystemProfile ? (\n        <section\n          className="creator-stats-card creator-stats-card-clickable creator-system-stats"\n          aria-label="BURGRS system profile stats"\n        >\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>{systemStats.shows.toLocaleString("en-GB")}</strong>\n            <span>Shows</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>{systemStats.episodes.toLocaleString("en-GB")}</strong>\n            <span>Episodes watched</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>100%</strong>\n            <span>Complete</span>\n          </button>\n        </section>\n      ) : (\n        <section className="creator-stats-card creator-stats-card-clickable" aria-label="Creator profile sections">\n          <button\n            type="button"\n            className={getStatButtonClass("followers")}\n            onClick={() => setActiveProfilePanel("followers")}\n          >\n            <strong>{followersCount}</strong>\n            <span>Followers</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("following")}\n            onClick={() => setActiveProfilePanel("following")}\n          >\n            <strong>{followingCount}</strong>\n            <span>Following</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("posts")}\n            onClick={() => setActiveProfilePanel("posts")}\n          >\n            <strong>{posts.length}</strong>\n            <span>Posts</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("lists")}\n            onClick={() => setActiveProfilePanel("lists")}\n          >\n            <strong>{listCount}</strong>\n            <span>Lists</span>\n          </button>\n          <button\n            type="button"\n            className={getStatButtonClass("reviews")}\n            onClick={() => setActiveProfilePanel("reviews")}\n          >\n            <strong>{reviews.length}</strong>\n            <span>Reviews</span>\n          </button>\n        </section>\n      )}\n'''
creator = replace_once(creator, old_stats, new_stats, "creator stats")

creator = replace_once(
    creator,
    '              <h2>Creator lists</h2>\n',
    '              <h2>{isSystemProfile ? "System collection" : "Creator lists"}</h2>\n',
    "lists heading",
)

creator = replace_once(
    creator,
    '''                  const subtitle = `${itemCount} show${itemCount === 1 ? "" : "s"}${\n                    list.visibility === "private" ? " • Private draft" : ""\n                  }`;\n''',
    '''                  const subtitle =\n                    list.subtitle ||\n                    `${itemCount} show${itemCount === 1 ? "" : "s"}${\n                      list.visibility === "private" ? " • Private draft" : ""\n                    }`;\n''',
    "custom system list subtitle",
)

creator = replace_once(
    creator,
    '                      badge={formatDate(list.created_at)}\n',
    '                      badge={list.badge || formatDate(list.created_at)}\n',
    "custom system list badge",
)

creator_path.write_text(creator)

stats_path = Path("src/pages/CreatorProfileStats.css")
stats = stats_path.read_text()
if "creator-system-stats" not in stats:
    stats += '''\n\n.creator-stats-card.creator-stats-card-clickable.creator-system-stats {\n  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;\n}\n'''
stats_path.write_text(stats)

chats_path = Path("src/creator-profile-chats.js")
chats = chats_path.read_text()
chats = replace_once(
    chats,
    '''  if (!slug) {\n    restoreNativePanel();\n    return;\n  }\n\n  const statsCard = document.querySelector(\n''',
    '''  if (!slug) {\n    restoreNativePanel();\n    return;\n  }\n\n  if (["burgrs", "admin"].includes(slug.toLowerCase())) {\n    document.querySelector(`[${CHAT_BUTTON_ATTR}]`)?.remove();\n    restoreNativePanel();\n    return;\n  }\n\n  const statsCard = document.querySelector(\n''',
    "system profile chats guard",
)
chats_path.write_text(chats)
