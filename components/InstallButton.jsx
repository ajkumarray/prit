'use client'

import { useCallback, useEffect, useState } from 'react'
import { InstallIcon } from './icons.jsx'

/** Already running from the home screen / dock? Then there's nothing to offer. */
function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

/**
 * The install button, plus service worker registration.
 *
 * Chrome fires `beforeinstallprompt` when a site qualifies; we hold onto that
 * event and fire it on click. iOS never fires it and has no programmatic
 * install at all, so Safari gets a short instruction instead of a button that
 * would do nothing.
 *
 * Renders nothing when the app can't be installed or already is — better than
 * a dead control.
 */
export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [iosSafari, setIosSafari] = useState(false)

  useEffect(() => {
    if (isStandalone()) setInstalled(true)

    // iOS Safari: installable by hand, but never fires beforeinstallprompt.
    const ua = window.navigator.userAgent
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)
    setIosSafari(isIos && !/CriOS|FxiOS|EdgiOS/.test(ua))

    const onPrompt = (event) => {
      event.preventDefault() // stop Chrome's own mini-infobar
      setPromptEvent(event)
    }
    const onInstalled = () => {
      setPromptEvent(null)
      setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // The worker is what makes the site installable in the first place. Only
    // in production — a worker in front of the dev server fights HMR.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err.message)
      })
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!promptEvent) return
    promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    // The event is single-use whichever way it goes.
    setPromptEvent(null)
    if (outcome === 'accepted') setInstalled(true)
  }, [promptEvent])

  if (installed) return null

  const chip =
    'flex items-center gap-1.5 rounded-full border border-cream/15 px-3 py-1.5 font-mono ' +
    'text-[0.6rem] tracking-[0.16em] text-sand/80 uppercase transition hover:border-cream/35 hover:text-cream'

  if (promptEvent) {
    return (
      <button type="button" onClick={install} title="Install Prit Radio" className={chip}>
        <InstallIcon className="size-3" />
        install
      </button>
    )
  }

  if (iosSafari) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          aria-expanded={showHint}
          className={chip}
        >
          <InstallIcon className="size-3" />
          install
        </button>
        {showHint && (
          <p className="glass absolute right-0 top-full z-30 mt-2 w-56 rounded-xl px-3 py-2 text-left text-[0.7rem] leading-relaxed text-cream/85 normal-case">
            Tap the Share button in Safari, then <b>Add to Home Screen</b>.
          </p>
        )}
      </div>
    )
  }

  return null
}
