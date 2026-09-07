'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const API_SRC = 'https://www.youtube.com/iframe_api'

/** Loads the YouTube IFrame API once, no matter how many callers ask. */
let apiPromise = null
function loadYouTubeApi() {
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)

    // The API calls this global when it finishes booting.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT)
    }

    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement('script')
      script.src = API_SRC
      document.head.appendChild(script)
    }
  })

  return apiPromise
}

/**
 * A shuffled running order — Fisher-Yates over the track positions.
 *
 * `avoidFirst` keeps a reshuffle from opening with the song that just closed
 * the previous pass, which is the one repeat a listener would actually notice.
 */
function shuffleOrder(length, avoidFirst = -1) {
  const order = Array.from({ length }, (_, i) => i)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  if (length > 1 && order[0] === avoidFirst) {
    const j = 1 + Math.floor(Math.random() * (length - 1))
    ;[order[0], order[j]] = [order[j], order[0]]
  }
  return order
}

/**
 * Drives a hidden YouTube player as a radio: play, pause, next.
 *
 * The running order is always shuffled. Rather than picking a random song each
 * time — which repeats and drops songs entirely — it shuffles the whole
 * playlist into a running order and plays through it, reshuffling for the next
 * pass. Every song plays once before any plays twice.
 *
 * Tracks advance on their own when a song ends, and a video that refuses to
 * play (removed, or blocked from embedding) is skipped rather than stalling.
 *
 * What is loaded is tracked by video id rather than list position, so a sync
 * that changes the playlist underneath us doesn't interrupt the song playing.
 */
const VOLUME_KEY = 'prit-radio-volume'

export function useRadio(tracks) {
  // Starts as the plain order so server and client render the same first song;
  // the effect below shuffles once the client has taken over.
  const [order, setOrder] = useState(() => tracks.map((_, i) => i))
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  // Read from storage after mount, not during render — localStorage doesn't
  // exist on the server and would break hydration.
  const [volume, setVolumeState] = useState(80)
  const [muted, setMuted] = useState(false)

  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const loadedIdRef = useRef(null) // the ytId currently in the player
  const playingRef = useRef(false)
  const autoplayRef = useRef(false) // start the next load without waiting for a click
  const tracksRef = useRef(tracks)
  const orderRef = useRef(order)
  const positionRef = useRef(position)

  tracksRef.current = tracks
  orderRef.current = order
  positionRef.current = position
  playingRef.current = playing

  const hasTracks = tracks.length > 0
  const track = tracks[order[position]] ?? null

  const advance = useCallback(() => {
    const currentOrder = orderRef.current
    const at = positionRef.current
    if (!currentOrder.length) return

    if (at + 1 < currentOrder.length) {
      setPosition(at + 1)
      return
    }

    // End of the pass — deal a fresh order and start it.
    setOrder(shuffleOrder(tracksRef.current.length, currentOrder[at]))
    setPosition(0)
  }, [])

  /**
   * Back a track — but a press part-way through a song restarts it instead,
   * which is what every music player does and what the hand expects.
   */
  const previous = useCallback(() => {
    const player = playerRef.current
    if (player?.getCurrentTime && player.getCurrentTime() > 3) {
      player.seekTo(0, true)
      setElapsed(0)
      return
    }

    const currentOrder = orderRef.current
    if (!currentOrder.length) return
    autoplayRef.current = true
    const at = positionRef.current
    setPosition(at > 0 ? at - 1 : currentOrder.length - 1)
  }, [])

  const seek = useCallback((seconds) => {
    const player = playerRef.current
    if (!player?.seekTo) return
    player.seekTo(seconds, true)
    setElapsed(seconds) // don't wait for the next poll to move the handle
  }, [])

  // Create the player once, and tear it down on unmount.
  useEffect(() => {
    if (!hasTracks) return

    let cancelled = false
    const container = hostRef.current

    loadYouTubeApi().then((YT) => {
      if (cancelled || !container) return

      // YT.Player *replaces* the element it is given, so hand it a throwaway
      // child rather than a node React is tracking.
      const mount = document.createElement('div')
      container.appendChild(mount)

      const first = tracksRef.current[orderRef.current[positionRef.current]]
      if (!first) return
      loadedIdRef.current = first.ytId

      playerRef.current = new YT.Player(mount, {
        height: '0',
        width: '0',
        videoId: first.ytId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true)
          },
          onStateChange: (event) => {
            const state = event.data
            setBuffering(state === YT.PlayerState.BUFFERING)
            if (state === YT.PlayerState.PLAYING) setPlaying(true)
            if (state === YT.PlayerState.PAUSED) setPlaying(false)
            if (state === YT.PlayerState.ENDED) {
              autoplayRef.current = true
              advance()
            }
          },
          // Unplayable video — don't let the radio dead-air on it.
          onError: () => {
            autoplayRef.current = playingRef.current
            advance()
          },
        },
      })
    })

    return () => {
      cancelled = true
      playerRef.current?.destroy?.()
      playerRef.current = null
      loadedIdRef.current = null
      if (container) container.innerHTML = ''
      setReady(false)
    }
  }, [hasTracks, advance])

  // Deal a shuffled order: once on mount, and again whenever a sync replaces
  // the track list. The song currently playing is slotted into the position
  // being played, so reshuffling never cuts it off mid-song.
  useEffect(() => {
    const fresh = shuffleOrder(tracks.length)
    const loaded = loadedIdRef.current

    if (loaded) {
      const stillAt = tracks.findIndex((t) => t.ytId === loaded)
      if (stillAt !== -1) {
        const here = Math.min(positionRef.current, fresh.length - 1)
        const moved = fresh.indexOf(stillAt)
        ;[fresh[here], fresh[moved]] = [fresh[moved], fresh[here]]
      }
    }

    setOrder(fresh)
  }, [tracks])

  // Swap in a new song whenever the target changes.
  useEffect(() => {
    const player = playerRef.current
    const next = tracks[order[position]]
    if (!ready || !player || !next) return
    if (loadedIdRef.current === next.ytId) return

    loadedIdRef.current = next.ytId
    const shouldPlay = playingRef.current || autoplayRef.current
    autoplayRef.current = false

    // The old song's numbers must not linger on the new one's bar.
    setElapsed(0)
    setDuration(0)

    // Keep playing if we were playing; otherwise just stage it silently.
    if (shouldPlay) player.loadVideoById(next.ytId)
    else player.cueVideoById(next.ytId)
  }, [order, position, ready, tracks])

  /**
   * Media Session metadata and playback state.
   *
   * This is what a mobile browser actually checks before deciding whether a
   * backgrounded or screen-locked tab is still "playing media" and thus worth
   * keeping alive, and it's what draws the lock-screen / notification-shade
   * player with track info and controls. Without it, background playback is
   * left entirely to chance.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      artwork: track.art ? [{ src: track.art, sizes: '640x640', type: 'image/jpeg' }] : [],
    })
  }, [track])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  // Restore the last volume the listener chose.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VOLUME_KEY)
      if (saved !== null) {
        const value = Number(saved)
        if (Number.isFinite(value)) {
          setVolumeState(Math.min(100, Math.max(0, value)))
          setMuted(value === 0)
        }
      }
    } catch {
      // Storage can be disabled; the default is fine.
    }
  }, [])

  // Push volume and mute into the player whenever either changes.
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player?.setVolume) return
    player.setVolume(volume)
    if (muted || volume === 0) player.mute()
    else player.unMute()
  }, [ready, volume, muted])

  /**
   * Poll the player for position and length.
   *
   * The IFrame API has no timeupdate event, so this is the only way to drive a
   * progress bar. Four times a second is smooth enough to look continuous
   * without waking up constantly, and it only runs while a song is playing.
   */
  useEffect(() => {
    if (!ready) return

    const tick = () => {
      const player = playerRef.current
      if (!player?.getCurrentTime) return
      const total = player.getDuration?.() ?? 0
      // getDuration reports 0 until metadata lands, then a stable number.
      setDuration((current) => (Math.abs(current - total) > 0.5 ? total : current))
      const now = player.getCurrentTime() ?? 0
      if (playingRef.current) setElapsed(now)

      // Drives the lock-screen / notification scrubber. Wrapped because some
      // browsers throw on an out-of-range position during a track swap.
      if (total > 0 && navigator.mediaSession?.setPositionState) {
        try {
          navigator.mediaSession.setPositionState({
            duration: total,
            playbackRate: 1,
            position: Math.min(now, total),
          })
        } catch {
          // Not worth failing the tick over.
        }
      }
    }

    tick()
    // Keep ticking while paused too, but lazily: a cued track still needs its
    // length read, otherwise the bar reads 0:00 / 0:00 until you press play.
    const id = setInterval(tick, playing ? 250 : 1000)
    return () => clearInterval(id)
  }, [ready, playing, position])

  const setVolume = useCallback((next) => {
    const value = Math.min(100, Math.max(0, Math.round(next)))
    setVolumeState(value)
    setMuted(value === 0)
    try {
      window.localStorage.setItem(VOLUME_KEY, String(value))
    } catch {
      // Not being able to remember it isn't worth failing over.
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      // Unmuting at zero would stay silent and look broken.
      if (current && volume === 0) setVolume(40)
      return !current
    })
  }, [volume, setVolume])

  const toggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (playingRef.current) player.pauseVideo()
    else player.playVideo()
  }, [])

  const next = useCallback(() => {
    // A press of "next" while paused is still a request to hear something.
    autoplayRef.current = true
    advance()
  }, [advance])

  // Wire the lock-screen / notification-shade controls to the same actions
  // as the on-page buttons.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    const actions = {
      play: () => playerRef.current?.playVideo?.(),
      pause: () => playerRef.current?.pauseVideo?.(),
      previoustrack: previous,
      nexttrack: next,
    }
    for (const [action, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Not every browser recognizes every action (e.g. Firefox and
        // previoustrack/nexttrack support varies).
      }
    }
    return () => {
      for (const action of Object.keys(actions)) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // Same as above.
        }
      }
    }
  }, [previous, next])

  return {
    hostRef,
    track,
    position,
    playing,
    ready,
    buffering,
    elapsed,
    duration,
    volume,
    muted,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
  }
}
