'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRadio } from '../lib/useRadio.js'
import Backdrop from './Backdrop.jsx'
import InstallButton from './InstallButton.jsx'
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  RefreshIcon,
  ShuffleIcon,
  VolumeIcon,
  MuteIcon,
} from './icons.jsx'

/** Seconds as m:ss, or a dash while the player still reports nothing. */
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const whole = Math.floor(seconds)
  const mins = Math.floor(whole / 60)
  return `${mins}:${String(whole % 60).padStart(2, '0')}`
}

function relativeTime(iso) {
  if (!iso) return null
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function EmptyState() {
  return (
    <div className="glass mx-auto w-full max-w-md rounded-2xl px-5 py-5 text-left">
      <p className="font-display text-lg font-bold text-cream">No songs loaded yet</p>
      <p className="mt-2 text-sm leading-relaxed text-sand/80">
        The playlist syncs from Spotify and resolves each song to a playable video.
        Hit sync, or wait for the nightly run.
      </p>
      <p className="mt-4 font-mono text-xs text-sand/70">npm run sync</p>
    </div>
  )
}

export default function Radio({ playlist }) {
  const router = useRouter()
  const tracks = playlist.tracks ?? []
  const {
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
  } = useRadio(tracks)

  // Non-null only while a seek is being dragged, so the polled time can't fight
  // the handle under the finger.
  const [scrub, setScrub] = useState(null)

  const [syncState, setSyncState] = useState('idle') // idle | syncing | done | error
  const [syncNote, setSyncNote] = useState(null)
  const [syncedLabel, setSyncedLabel] = useState(null)

  // Rendered on the client only — a server-rendered "3h ago" would be wrong by
  // the time anyone reads it, and would mismatch on hydration.
  useEffect(() => {
    setSyncedLabel(relativeTime(playlist.syncedAt))
  }, [playlist.syncedAt])

  const runSync = useCallback(async () => {
    setSyncState('syncing')
    setSyncNote(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        setSyncState('error')
        setSyncNote(body.error ?? `Sync failed (${res.status})`)
        return
      }

      setSyncState('done')
      setSyncNote(
        `${body.playable ?? 0} tracks` +
          (body.unmatched ? ` · ${body.unmatched} unmatched` : ''),
      )
      // Pull the new list in. Playback follows the current song across the swap.
      router.refresh()
    } catch (err) {
      setSyncState('error')
      setSyncNote(err.message)
    }
  }, [router])

  // Space to play/pause, right arrow to skip — as long as focus isn't in a field.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.target.closest('input, textarea, button, a')) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggle()
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        next()
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        previous()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle, next, previous])

  const syncing = syncState === 'syncing'
  const status = !tracks.length
    ? 'off air'
    : !ready
      ? 'warming up'
      : buffering
        ? 'buffering'
        : playing
          ? 'on air'
          : 'paused'

  return (
    <main
      data-playing={playing}
      className="scene relative min-h-[100dvh] w-full overflow-hidden"
    >
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 rings" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-[34%] size-[min(120vw,52rem)] -translate-x-1/2 -translate-y-1/2 halo"
      />
      <Backdrop />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 vignette" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 grain" />

      {/* The player itself is audio-only; the iframe never needs to be seen. */}
      <div ref={hostRef} className="pointer-events-none absolute size-px opacity-0" />

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8 sm:pt-6">
          <span className="flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.2em] text-sand/70 uppercase">
            <span className="relative flex size-2">
              {playing && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-70" />
              )}
              <span
                className={`relative inline-flex size-2 rounded-full ${playing ? 'bg-live' : 'bg-sand/40'}`}
              />
            </span>
            {status}
          </span>

          <div className="flex items-center gap-3">
            {tracks.length > 0 && (
              <span
                title="Shuffled — every song plays once before any repeats"
                className="flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.2em] text-sand/50 uppercase tabular-nums"
              >
                <ShuffleIcon className="size-3" />
                {position + 1} / {tracks.length}
              </span>
            )}
            <InstallButton />
            <button
              type="button"
              onClick={runSync}
              disabled={syncing}
              title={
                syncedLabel ? `Last synced ${syncedLabel}` : 'Re-sync from Spotify'
              }
              className="flex items-center gap-1.5 rounded-full border border-cream/15 px-3 py-1.5 font-mono text-[0.6rem] tracking-[0.16em] text-sand/80 uppercase transition hover:border-cream/35 hover:text-cream disabled:opacity-50"
            >
              <RefreshIcon className={`size-3 ${syncing ? 'spin-slow' : ''}`} />
              {syncing ? 'syncing' : 'sync'}
            </button>
          </div>
        </header>

        {/* Type and spacing step down on short screens so a landscape phone
            still shows the whole thing without scrolling. */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center sm:py-10 [@media(max-height:560px)]:py-3">
          <h1 className="font-[family-name:var(--font-deva)] text-6xl leading-[1.02] font-extrabold text-cream drop-shadow-[0_8px_34px_oklch(0.12_0.05_30/0.75)] sm:text-9xl [@media(max-height:560px)]:text-5xl">
            <span className="block">प्रीत</span>
            <span className="block">रेडियो</span>
          </h1>
          <p className="mt-4 font-mono text-[0.6rem] tracking-[0.42em] text-cream/60 uppercase sm:text-xs [@media(max-height:560px)]:mt-2">
            Prit Radio · open all hours
          </p>

          {syncNote && (
            <p
              className={`mt-5 max-w-sm font-mono text-[0.65rem] ${
                syncState === 'error' ? 'text-ember' : 'text-sand/60'
              }`}
            >
              {syncNote}
            </p>
          )}

          {tracks.length === 0 && (
            <div className="mt-10 w-full">
              <EmptyState />
            </div>
          )}
        </div>

        {tracks.length > 0 && (
          <div className="sticky bottom-0 z-20 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-8">
            <div className="glass mx-auto w-full max-w-2xl rounded-3xl p-3 sm:p-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-ember/25 sm:size-14">
                  {track?.ytId && (
                    /* Real album art when the sync had API access; the YouTube
                       thumbnail otherwise. The thumbnail is letterboxed 16:9,
                       so it needs scaling up to fill the square — a cover
                       already is one. */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={track.art || `https://i.ytimg.com/vi/${track.ytId}/default.jpg`}
                      alt=""
                      width="56"
                      height="56"
                      className={`size-full object-cover ${track.art ? '' : 'scale-135'}`}
                    />
                  )}
                </span>

                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-cream sm:text-base">
                    {track?.title ?? 'Tuning in…'}
                  </p>
                  <p className="truncate text-xs text-cream/60">
                    {track?.artist ?? 'Prit Radio'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                  <button
                    type="button"
                    onClick={previous}
                    disabled={!ready}
                    aria-label="Previous track"
                    title="Previous — restarts the song if it's already playing"
                    className="flex size-10 items-center justify-center rounded-full text-cream/80 transition hover:bg-cream/10 hover:text-cream disabled:opacity-40"
                  >
                    <PrevIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toggle}
                    disabled={!ready}
                    aria-label={playing ? 'Pause' : 'Play'}
                    className="flex size-11 items-center justify-center rounded-full bg-cream text-shade transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    disabled={!ready}
                    aria-label="Next track"
                    className="flex size-10 items-center justify-center rounded-full text-cream/80 transition hover:bg-cream/10 hover:text-cream disabled:opacity-40"
                  >
                    <NextIcon className="size-4" />
                  </button>
                </div>
              </div>

              {/* progress, and volume where there's room for it */}
              <div className="mt-3 flex items-center gap-3">
                <span className="w-9 shrink-0 text-right font-mono text-[0.65rem] text-cream/55 tabular-nums">
                  {clock(scrub ?? elapsed)}
                </span>

                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 1)}
                  step={1}
                  value={Math.min(scrub ?? elapsed, Math.max(duration, 1))}
                  disabled={!ready || !duration}
                  aria-label="Seek"
                  className="slider h-3 min-w-0 flex-1"
                  style={{
                    '--progress': `${duration ? (Math.min(scrub ?? elapsed, duration) / duration) * 100 : 0}%`,
                  }}
                  onChange={(event) => setScrub(Number(event.target.value))}
                  // Commit on release rather than on every pixel of the drag,
                  // so scrubbing doesn't fire a hundred seeks at the player.
                  onPointerUp={() => {
                    if (scrub === null) return
                    seek(scrub)
                    setScrub(null)
                  }}
                  onKeyUp={() => {
                    if (scrub === null) return
                    seek(scrub)
                    setScrub(null)
                  }}
                  onBlur={() => {
                    if (scrub === null) return
                    seek(scrub)
                    setScrub(null)
                  }}
                />

                <span className="w-9 shrink-0 font-mono text-[0.65rem] text-cream/55 tabular-nums">
                  {clock(duration)}
                </span>

                {/* Phones control volume with their own hardware keys, and iOS
                    ignores setVolume entirely — so this is desktop only. */}
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={toggleMute}
                    disabled={!ready}
                    aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                    className="flex size-8 items-center justify-center rounded-full text-cream/70 transition hover:bg-cream/10 hover:text-cream disabled:opacity-40"
                  >
                    {muted || volume === 0 ? (
                      <MuteIcon className="size-4" />
                    ) : (
                      <VolumeIcon className="size-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={muted ? 0 : volume}
                    disabled={!ready}
                    aria-label="Volume"
                    className="slider h-3 w-20"
                    style={{ '--progress': `${muted ? 0 : volume}%` }}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-[0.65rem] text-cream/40">
              Audio streams from YouTube. Nothing is hosted here.
              {syncedLabel && <> · synced {syncedLabel}</>}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
