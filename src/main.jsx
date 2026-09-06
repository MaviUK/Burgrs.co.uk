import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ProfileIssueReportMount from './components/ProfileIssueReportMount'
import NativePushPrompt from './components/NativePushPrompt'
import { installShowCommunityPortal } from './components/ShowCommunityPortal'
import { supabase } from './lib/supabase'
import { installNativeApiBridge } from './lib/installNativeApiBridge'
import { installNativeAuthLinks } from './lib/installNativeAuthLinks'
import { installMobileOverscrollGuard } from './lib/installMobileOverscrollGuard'
import { installUserCacheIsolation } from './lib/installUserCacheIsolation'
import { installDeletedUserRedirect } from './lib/installDeletedUserRedirect'
import { installSingleSessionEnforcement } from './lib/installSingleSessionEnforcement'
import { installRegionAwareStreaming } from './lib/installRegionAwareStreaming'
import './index.css'
import './rankd-button-fixes.css'
import './mobile-header-consistency.css'
import './rankd-social-share.css'
import './activity-share-buttons.css'
import './rankd-guest-share-vote.css'
import './public-shared-content.css'
import './show-data-refresh-button.css'
import './remove-show-data-refresh-button.css'
import './dashboard-premiering-soon.css'
import './dashboard-loading-screen.css'
import './firefox-mobile-nav-fix.css'
import './notification-alerts.css'
import './public-show-watch-providers.css'
import './show-data-attribution.css'
import './creator-profile-chats.css'
import './creator-list-comments.css'
import './following-list-card-consistency.css'
import './creator-generated-banner.css'
import './profile-edit-bottom-spacing.css'
import './creator-profile-header-layout.css'
import './header-profile-username-fix.css'
import './creator-profile-loading.css'
import './app-startup-loading.css'
import './creator-bio-limit.css'
import './creator-rankd-list-button.css'
import './actor-page-mobile-fixes.css'
import './search-pagination.css'
import './search-header-spacing.css'
import './components/ReviewThreadExtras.css'
import './theme-pink-teal-cream.css'
import './dashboard-theme-readability.css'
import './following-theme-readability.css'
import './my-show-details-theme.css'
import './my-show-details-width-fix.css'
import './my-show-details-text-readability.css'
import './notifications-theme-readability.css'
import './my-shows-list-theme.css'
import './rankd-theme-readability.css'
import './original-content-theme.css'
import './my-show-action-menu-theme.css'
import './global-pink-button-theme.css'
import './rankd-final-pink-fixes.css'
import './review-focus-pink.css'
import './notifications-final-pink-fixes.css'
import './following-final-pink-fixes.css'
import './profile-final-pink-fixes.css'
import './profile-tools-final-pink-fixes.css'
import './login-final-pink-fixes.css'
import './following-rating-plain-text.css'
import './show-page-polish.css'
import './show-trailer-thumbnail.css'
import './search-result-card-polish.css'

installNativeApiBridge()
installNativeAuthLinks()
installMobileOverscrollGuard()
installUserCacheIsolation()
installDeletedUserRedirect(supabase)
installSingleSessionEnforcement(supabase)
installRegionAwareStreaming()
installShowCommunityPortal(supabase)

function loadDeferredEnhancements() {
  return Promise.allSettled([
    import('./rankd-scroll-fix.js'),
    import('./rankd-social-share.js'),
    import('./dashboard-airing-link-fix.js'),
    import('./activity-share-buttons.js'),
    import('./rankd-guest-share-vote.js'),
    import('./rankd-shared-stats-fix.js'),
    import('./public-shared-content.js'),
    import('./show-data-refresh-button.js'),
    import('./dashboard-premiering-soon.js'),
    import('./dashboard-loading-screen.js'),
    import('./notification-nav-badge.js'),
    import('./notification-deep-links.js'),
    import('./notification-copy-cleanup.js'),
    import('./public-show-watch-providers.js'),
    import('./show-page-polish.js'),
    import('./show-trailer-thumbnail.js'),
    import('./specials-collapse.js'),
    import('./show-data-attribution.js'),
    import('./public-show-review-access.js'),
    import('./creator-profile-chats.js'),
    import('./creator-list-comments.js'),
    import('./following-list-card-consistency.js'),
    import('./creator-generated-banner.js'),
    import('./creator-profile-header-layout.js'),
    import('./header-profile-username-fix.js'),
    import('./creator-bio-limit.js'),
    import('./creator-rankd-list-button.js'),
    import('./studio-search-link-fix.js'),
    import('./search-newest-first.js'),
    import('./search-result-card-polish.js'),
    import('./following-find-creators-link.js'),
  ])
}

function scheduleDeferredEnhancements() {
  const load = () => {
    loadDeferredEnhancements().then((results) => {
      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length) {
        console.warn(`Failed to load ${failed.length} deferred BURGRS enhancement(s).`)
      }
    })
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(load, { timeout: 1200 })
    return
  }

  window.setTimeout(load, 250)
}

scheduleDeferredEnhancements()

function BootReady() {
  React.useEffect(() => {
    const loader = document.getElementById('boot-loader')
    if (!loader) return

    loader.style.opacity = '0'
    loader.style.pointerEvents = 'none'
    loader.style.transition = 'opacity 160ms ease'

    const timer = window.setTimeout(() => loader.remove(), 180)
    return () => window.clearTimeout(timer)
  }, [])

  return null
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('BURGRS render failed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-startup-loading" role="alert">
          <div className="app-startup-loading-card">
            <div className="app-startup-loading-burger" aria-hidden="true">🍔</div>
            <strong>BURGRS could not load</strong>
            <span>Please reload and try again.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                width: '100%',
                minHeight: 44,
                border: 0,
                borderRadius: 999,
                background: '#f8fafc',
                color: '#111827',
                fontWeight: 900,
              }}
            >
              Reload
            </button>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BootReady />
    <AppErrorBoundary>
      <App />
      <ProfileIssueReportMount />
      <NativePushPrompt />
    </AppErrorBoundary>
  </React.StrictMode>,
)
