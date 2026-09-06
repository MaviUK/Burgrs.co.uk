import { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useLocation,
  Navigate,
} from "react-router-dom";
import "./index.css";
import "./mobile-fixes.css";
import BurgrsBanner from "./components/BurgrsBanner";
import ProfileBlockButton from "./components/ProfileBlockButton";
import { supabase } from "./lib/supabase";
import { installMyShowWatchProgressFix } from "./lib/myShowWatchProgressFix";

const ProfileEditMerged = lazy(() => import("./pages/ProfileEditMerged"));
const CreatorProfile = lazy(() => import("./pages/CreatorProfile"));
const CreatorListEditor = lazy(() => import("./pages/CreatorListEditor"));
const CreatorPostEditor = lazy(() => import("./pages/CreatorPostEditor"));
const FollowingFeed = lazy(() => import("./pages/FollowingFeed"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Search = lazy(() => import("./pages/Search"));
const Login = lazy(() => import("./pages/Login"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const ShowDetails = lazy(() => import("./pages/ShowDetails"));
const MyShows = lazy(() => import("./pages/MyShows"));
const MyShowDetails = lazy(() => import("./pages/MyShowDetails"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const ActorPage = lazy(() => import("./pages/ActorPage"));
const Rankd = lazy(() => import("./pages/Rankd"));

const HEADER_PROFILE_CACHE_PREFIX = "burgrs-header-profile:";

function readCachedHeaderProfile(userId) {
  if (!userId) return null;

  try {
    const raw = window.localStorage.getItem(`${HEADER_PROFILE_CACHE_PREFIX}${userId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.username) return null;

    return {
      id: parsed.id || userId,
      username: String(parsed.username).trim(),
      full_name: parsed.full_name || "",
      avatar_url: parsed.avatar_url || "",
    };
  } catch {
    return null;
  }
}

function writeCachedHeaderProfile(profile) {
  if (!profile?.id || !profile?.username) return;

  try {
    window.localStorage.setItem(
      `${HEADER_PROFILE_CACHE_PREFIX}${profile.id}`,
      JSON.stringify({
        id: profile.id,
        username: String(profile.username).trim(),
        full_name: profile.full_name || "",
        avatar_url: profile.avatar_url || "",
      })
    );
  } catch {
    // Storage can be blocked in private browsing; the live profile still works.
  }
}

function waitFor(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ShowsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M7 3v4M17 3v4M3 9h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RankdIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 14h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 18h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 10a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 20a2.4 2.4 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function UserProfileLink({ session, profile, className = "top-profile-link" }) {
  if (!session) return null;

  if (!profile?.username) {
    return (
      <div
        className={`${className} top-profile-link-pending`}
        aria-label="Loading your profile"
        aria-busy="true"
      >
        <div className="top-profile-avatar top-profile-avatar-loading" />
        <span className="top-profile-text">
          <span className="top-profile-name top-profile-name-loading" />
        </span>
      </div>
    );
  }

  const username = String(profile.username).trim();
  const displayName = `@${username}`;
  const avatarUrl = profile.avatar_url || "";
  const profilePath = `/u/${encodeURIComponent(username)}`;
  const initial = username.charAt(0).toUpperCase();

  return (
    <NavLink to={profilePath} className={className} aria-label={displayName}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={displayName} className="top-profile-avatar" />
      ) : (
        <div className="top-profile-avatar top-profile-avatar-placeholder">{initial}</div>
      )}
      <span className="top-profile-text">
        <span className="top-profile-name">{displayName}</span>
      </span>
    </NavLink>
  );
}

function isPublicSharedPage(pathname) {
  return (
    pathname.startsWith("/rankd/share/") ||
    pathname.startsWith("/u/") ||
    pathname.startsWith("/show/")
  );
}

function DesktopNav({ session, profile }) {
  const location = useLocation();
  const isPublicPage = isPublicSharedPage(location.pathname);

  if (!session && !isPublicPage) return null;

  return (
    <div className="nav-wrap desktop-nav">
      <div className="top-header-bar">
        <nav className="top-tabs">
          <NavLink to="/" end className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Dashboard</NavLink>
          <NavLink to="/following" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Following</NavLink>
          <NavLink to="/notifications" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Notifications</NavLink>
          <NavLink to="/search" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Search</NavLink>
          <NavLink to="/my-shows" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>My Shows</NavLink>
          <NavLink to="/rankd" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Rank&apos;d</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `top-tab${isActive ? " active" : ""}`}>Calendar</NavLink>
        </nav>
        <UserProfileLink session={session} profile={profile} />
      </div>
    </div>
  );
}

function MobileTopBanner({ session, profile }) {
  const location = useLocation();
  const isPublicPage = isPublicSharedPage(location.pathname);

  if ((!session && !isPublicPage) || location.pathname === "/login") return null;

  return (
    <div className="mobile-top-banner-wrap">
      <BurgrsBanner />
      <UserProfileLink session={session} profile={profile} className="top-profile-link mobile-profile-link" />
    </div>
  );
}

function MobileBottomNav({ session }) {
  const location = useLocation();
  if (!session || location.pathname === "/login") return null;

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <NavLink to="/" end className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><HomeIcon /></span>
        <span className="mobile-nav-label">Home</span>
      </NavLink>
      <NavLink to="/following" className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><ShowsIcon /></span>
        <span className="mobile-nav-label">Follow</span>
      </NavLink>
      <NavLink to="/notifications" className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><BellIcon /></span>
        <span className="mobile-nav-label">Alerts</span>
      </NavLink>
      <NavLink to="/search" className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><SearchIcon /></span>
        <span className="mobile-nav-label">Search</span>
      </NavLink>
      <NavLink to="/my-shows" className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><ShowsIcon /></span>
        <span className="mobile-nav-label">Shows</span>
      </NavLink>
      <NavLink to="/rankd" className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}>
        <span className="mobile-nav-icon"><RankdIcon /></span>
        <span className="mobile-nav-label">Rank</span>
      </NavLink>
    </nav>
  );
}

function ScrollToTopOnRouteChange() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  return null;
}

function AuthRedirect({ session }) {
  if (session) return <Dashboard />;
  return <Navigate to="/login" replace />;
}

function ProtectedRoute({ session, children }) {
  const location = useLocation();

  if (!session) {
    const redirectTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirectTo)}`} replace />;
  }

  return children;
}

function LoginRoute({ session }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const redirectTo = params.get("redirect") || "/";
  const shouldSetPassword = params.get("setPassword") === "1";

  if (session && shouldSetPassword) return <SetPassword />;
  if (session) return <Navigate to={redirectTo} replace />;
  return <Login />;
}

function AppStartupLoading() {
  return (
    <main className="app-startup-loading" aria-live="polite" aria-busy="true">
      <div className="app-startup-loading-card">
        <div className="app-startup-loading-burger" aria-hidden="true">🍔</div>
        <strong>Loading BURGRS...</strong>
        <span>Getting everything ready</span>
        <div className="app-startup-loading-bar" aria-hidden="true" />
      </div>
    </main>
  );
}

function MobileOnlyScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, rgba(124, 58, 237, 0.18), transparent 34%), #020617",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: "28px",
        textAlign: "center",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "28px 22px",
          borderRadius: "28px",
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(148, 163, 184, 0.22)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: "34px", lineHeight: 1, letterSpacing: "-0.04em" }}>
          BURGRS is mobile only
        </h1>
        <p style={{ margin: "0", color: "#cbd5e1", fontSize: "17px", lineHeight: 1.5 }}>
          Please open BURGRS on your phone to continue.
        </p>
        <p style={{ margin: "18px 0 0", color: "#94a3b8", fontSize: "14px", lineHeight: 1.45 }}>
          Desktop and tablet-width screens are disabled for now.
        </p>
      </div>
    </div>
  );
}

function AppLayout() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  useEffect(() => installMyShowWatchProgressFix(), []);

  useEffect(() => {
    let mounted = true;
    let sessionResolved = false;

    const failSafeTimer = window.setTimeout(() => {
      if (!mounted || sessionResolved) return;
      console.warn("Session loading timed out; continuing without a session.");
      setProfile(null);
      setSession(null);
    }, 4500);

    const resolveSession = (nextSession) => {
      if (!mounted) return;

      sessionResolved = true;
      window.clearTimeout(failSafeTimer);

      const nextUserId = nextSession?.user?.id || "";
      setProfile((current) => {
        if (!nextUserId) return null;
        if (current?.id === nextUserId && current?.username) return current;
        return readCachedHeaderProfile(nextUserId) || undefined;
      });
      setSession(nextSession ?? null);
    };

    const loadSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        resolveSession(data?.session ?? null);
      } catch (error) {
        console.error("Error loading session:", error);
        resolveSession(null);
      }
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      resolveSession(nextSession);
    });

    return () => {
      mounted = false;
      window.clearTimeout(failSafeTimer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const refreshProfile = () => {
      setProfileRefreshKey((value) => value + 1);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshProfile();
    };

    const handleProfileUpdated = (event) => {
      const nextProfile = event?.detail;
      if (
        nextProfile?.id &&
        nextProfile?.username &&
        nextProfile.id === session?.user?.id
      ) {
        const normalized = {
          id: nextProfile.id,
          username: String(nextProfile.username).trim(),
          full_name: nextProfile.full_name || "",
          avatar_url: nextProfile.avatar_url || "",
        };
        writeCachedHeaderProfile(normalized);
        setProfile(normalized);
        return;
      }

      refreshProfile();
    };

    window.addEventListener("pageshow", refreshProfile);
    window.addEventListener("focus", refreshProfile);
    window.addEventListener("burgrs:profile-updated", handleProfileUpdated);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pageshow", refreshProfile);
      window.removeEventListener("focus", refreshProfile);
      window.removeEventListener("burgrs:profile-updated", handleProfileUpdated);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const userId = session?.user?.id;

      if (!userId) {
        setProfile(null);
        return;
      }

      const cachedProfile = readCachedHeaderProfile(userId);
      setProfile((current) => {
        if (current?.id === userId && current?.username) return current;
        return cachedProfile || undefined;
      });

      let attempt = 0;

      while (active) {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, username, full_name, avatar_url")
            .eq("id", userId)
            .maybeSingle();

          if (error) throw error;
          if (!active) return;

          if (data?.username) {
            const normalized = {
              id: data.id,
              username: String(data.username).trim(),
              full_name: data.full_name || "",
              avatar_url: data.avatar_url || "",
            };
            writeCachedHeaderProfile(normalized);
            setProfile(normalized);
            return;
          }
        } catch (error) {
          if (active) {
            console.warn("Header profile load attempt failed:", error);
          }
        }

        attempt += 1;
        const delay = Math.min(700 * 2 ** Math.min(attempt - 1, 4), 10000);
        await waitFor(delay);
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [session?.user?.id, profileRefreshKey]);

  if (session === undefined) return <AppStartupLoading />;

  const routeUserKey = session?.user?.id || "anonymous";

  return (
    <>
      <ScrollToTopOnRouteChange />
      <MobileTopBanner session={session} profile={profile} />

      <Suspense fallback={<AppStartupLoading />}>
        <Routes key={routeUserKey}>
          <Route path="/" element={<AuthRedirect session={session} />} />
          <Route path="/login" element={<LoginRoute session={session} />} />
          <Route path="/following" element={<ProtectedRoute session={session}><FollowingFeed /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute session={session}><Notifications /></ProtectedRoute>} />
          <Route path="/u/:username" element={<CreatorProfile />} />
          <Route path="/creator/lists/new" element={<ProtectedRoute session={session}><CreatorListEditor /></ProtectedRoute>} />
          <Route path="/creator/posts/new" element={<ProtectedRoute session={session}><CreatorPostEditor /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute session={session}><Search /></ProtectedRoute>} />
          <Route path="/show/:id" element={<ShowDetails />} />
          <Route path="/show/tmdb/:tmdbId" element={<ShowDetails />} />
          <Route path="/my-shows" element={<ProtectedRoute session={session}><MyShows /></ProtectedRoute>} />
          <Route path="/my-shows/:id" element={<ProtectedRoute session={session}><MyShowDetails /></ProtectedRoute>} />
          <Route path="/my-shows/tmdb/:tmdbId" element={<ProtectedRoute session={session}><MyShowDetails /></ProtectedRoute>} />
          <Route path="/actor/:name" element={<ProtectedRoute session={session}><ActorPage /></ProtectedRoute>} />
          <Route path="/calendar" element={<ProtectedRoute session={session}><CalendarPage /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute session={session}><ProfileEditMerged /></ProtectedRoute>} />
          <Route path="/rankd" element={<ProtectedRoute session={session}><Rankd /></ProtectedRoute>} />
          <Route path="/rankd/share/:slug" element={<Rankd />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <ProfileBlockButton />
      <MobileBottomNav session={session} />
    </>
  );
}

function App() {
  const [isMobileWidth, setIsMobileWidth] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth <= 768;
  });

  useEffect(() => {
    function handleResize() {
      setIsMobileWidth(window.innerWidth <= 768);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  if (!isMobileWidth) return <MobileOnlyScreen />;

  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;
