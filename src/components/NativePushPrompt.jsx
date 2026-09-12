import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '../lib/supabase'
import './NativePushPrompt.css'

const DISMISSED_KEY = 'burgrs_push_prompt_dismissed'
const TOKEN_KEY = 'burgrs_push_device_token'

async function saveDeviceToken(token) {
  if (!token) return
  window.localStorage.setItem(TOKEN_KEY, token)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return

  const { error } = await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: Capacitor.getPlatform(),
  })

  if (error) throw error
  window.dispatchEvent(new CustomEvent('burgrs:push-token', { detail: token }))
}

function openNotificationTarget(notification) {
  const data = notification?.data || {}
  const target = data.url || data.path || data.deepLink || data.deeplink
  if (!target) return

  try {
    const url = new URL(target, window.location.origin)
    if (url.origin === window.location.origin) {
      window.location.assign(`${url.pathname}${url.search}${url.hash}`)
      return
    }
    window.location.assign(url.toString())
  } catch (error) {
    console.warn('Unable to open push notification target:', error)
  }
}

export default function NativePushPrompt() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let cancelled = false
    const listeners = []

    async function setupPush() {
      try {
        listeners.push(await PushNotifications.addListener('registration', async (token) => {
          try {
            await saveDeviceToken(token.value)
            if (!cancelled) {
              setMessage('Notifications are ready on this phone.')
              setBusy(false)
              window.setTimeout(() => setVisible(false), 900)
            }
          } catch (error) {
            console.error('Failed saving push token:', error)
            if (!cancelled) {
              setMessage('This phone registered, but BURGRS could not save it. Please try again.')
              setBusy(false)
            }
          }
        }))

        listeners.push(await PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration failed:', error)
          if (!cancelled) {
            setMessage('This phone could not be registered. Please try again.')
            setBusy(false)
          }
        }))

        listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
          openNotificationTarget(event.notification)
        }))

        const status = await PushNotifications.checkPermissions()
        if (status.receive === 'granted') {
          await PushNotifications.register()
        } else if (window.localStorage.getItem(DISMISSED_KEY) !== '1' && !cancelled) {
          setVisible(true)
        }
      } catch (error) {
        console.error('Unable to initialise push notifications:', error)
      }
    }

    setupPush()

    const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      const token = window.localStorage.getItem(TOKEN_KEY)
      if (token) saveDeviceToken(token).catch((error) => console.error('Failed refreshing push token:', error))
    })

    return () => {
      cancelled = true
      listeners.forEach((listener) => listener.remove())
      authSubscription.data.subscription.unsubscribe()
    }
  }, [])

  async function enableNotifications() {
    if (busy) return
    setBusy(true)
    setMessage('')

    try {
      let status = await PushNotifications.checkPermissions()
      if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
        status = await PushNotifications.requestPermissions()
      }

      if (status.receive !== 'granted') {
        setMessage('Notifications were not enabled. You can allow them later in phone settings.')
        setBusy(false)
        return
      }

      window.localStorage.removeItem(DISMISSED_KEY)
      await PushNotifications.register()
    } catch (error) {
      console.error('Unable to enable notifications:', error)
      setMessage('Notifications could not be enabled. Please try again.')
      setBusy(false)
    }
  }

  function dismissPrompt() {
    window.localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="native-push-prompt-backdrop" role="presentation">
      <section className="native-push-prompt" role="dialog" aria-modal="true" aria-labelledby="native-push-title">
        <div className="native-push-icon" aria-hidden="true">🔔</div>
        <h2 id="native-push-title">Never miss what’s next</h2>
        <p>Get phone alerts for new episodes, replies and important BURGRS activity.</p>
        {message ? <div className="native-push-message" role="status">{message}</div> : null}
        <button className="native-push-enable" type="button" onClick={enableNotifications} disabled={busy}>
          {busy ? 'Enabling…' : 'Enable notifications'}
        </button>
        <button className="native-push-later" type="button" onClick={dismissPrompt} disabled={busy}>
          Not now
        </button>
      </section>
    </div>
  )
}
