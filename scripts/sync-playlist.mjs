#!/usr/bin/env node
/**
 * Mirrors a Spotify playlist into data/playlist.json, resolving each track to a
 * YouTube video id so the frontend can play it without ever touching an API.
 *
 *   npm run sync
 *
 * Nothing here ships to the browser. Credentials, if any, come from the
 * environment; the app only ever loads the generated JSON.
 *
 * This module is deliberately side-effect free and reads no configuration of
 * its own, so the /api/sync route can import it without dragging the whole
 * project into the build. The CLI wrapper lives in sync-cli.mjs.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PLAYLIST_PATH } from '../lib/paths.js'

export { PLAYLIST_PATH }

/** The playlist this radio is built around. Override with SPOTIFY_PLAYLIST. */
export const DEFAULT_PLAYLIST = '0BYFO12JqbeR5S2sWTUjRU'

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

/** How long any single request may take before we give up on it. */
const REQUEST_TIMEOUT_MS = Number(process.env.SYNC_REQUEST_TIMEOUT_MS ?? 15000)

/**
 * fetch with a deadline.
 *
 * This runs unattended on a nightly schedule, where a connection that opens and
 * then stalls would otherwise hang the job indefinitely — no error, no progress.
 */
function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

// --- spotify ---------------------------------------------------------------

export function parsePlaylistId(input) {
  if (!input) return null
  const trimmed = input.trim()
  const fromUrl = trimmed.match(/playlist[/:]([a-zA-Z0-9]+)/)
  if (fromUrl) return fromUrl[1]
  return /^[a-zA-Z0-9]+$/.test(trimmed) ? trimmed : null
}

/**
 * Read the playlist straight off Spotify's public embed page.
 *
 * No credentials, no app registration — the same data the embeddable player
 * uses. Capped at the first 100 tracks, which is where the official API below
 * earns its keep.
 */
async function fetchViaEmbed(playlistId) {
  const res = await fetchWithTimeout(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  })
  if (!res.ok) throw new Error(`Spotify embed request failed (${res.status})`)

  const html = await res.text()
  const payload = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!payload) {
    throw new Error(
      'Could not read the Spotify embed page — its markup may have changed.\n' +
        '  Add SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET to .env to use the official API instead.',
    )
  }

  const entity = JSON.parse(payload[1])?.props?.pageProps?.state?.data?.entity
  if (!entity?.trackList?.length) {
    throw new Error(`Playlist ${playlistId} has no readable tracks. Is it public?`)
  }

  const tracks = entity.trackList
    .filter((item) => item?.title)
    .map((item) => ({
      id: item.uri?.split(':').pop() ?? item.uid,
      title: item.title,
      // The embed flattens artists into one string, credits included.
      artist: item.subtitle ?? '',
      album: '',
      art: '',
    }))

  return {
    name: entity.name ?? 'Untitled playlist',
    tracks,
    source: 'embed',
    // The embed never returns more than 100. Landing exactly on it almost
    // always means the playlist is longer and we're seeing a truncated view.
    capped: tracks.length >= 100,
  }
}

/**
 * Mint an access token.
 *
 * A refresh token is the only durable option. Spotify no longer lets app-only
 * (client_credentials) tokens read playlist contents — they authenticate fine
 * and then answer 403 on every track endpoint, because there's no user behind
 * them. `npm run spotify-auth` produces a refresh token once; it doesn't expire.
 *
 * client_credentials is still attempted as a fallback, since it costs one
 * request and may be all a future Spotify policy needs.
 */
async function getSpotifyToken(clientId, clientSecret, refreshToken) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const body = refreshToken
    ? `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    : 'grant_type=client_credentials'

  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200)
    throw new Error(
      refreshToken
        ? `Spotify refused the refresh token (${res.status}). Re-run "npm run spotify-auth".\n  ${detail}`
        : `Spotify auth failed (${res.status}). Check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.\n  ${detail}`,
    )
  }
  return (await res.json()).access_token
}

/**
 * The official API: no 100-track ceiling, and it returns album art.
 *
 * Takes either a ready-made bearer token (SPOTIFY_TOKEN — handy for a one-off
 * run, but these expire within the hour) or a client id/secret pair, which
 * mints a fresh token per run and is what the nightly job needs.
 */
async function fetchViaApi(playlistId, { token, clientId, clientSecret, refreshToken }) {
  const bearer = token || (await getSpotifyToken(clientId, clientSecret, refreshToken))

  const meta = await fetchWithTimeout(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  )
  if (meta.status === 401) {
    throw new Error(
      'Spotify rejected the token (401).\n' +
        '  SPOTIFY_TOKEN values expire about an hour after they are issued.\n' +
        '  Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET for runs that keep working.',
    )
  }
  if (meta.status === 404) {
    throw new Error(
      `Playlist ${playlistId} not found.\n` +
        `  Note: Spotify blocks its own editorial playlists (Today's Top Hits etc.)\n` +
        `  for apps created after Nov 2024. Use a playlist you made yourself.`,
    )
  }
  if (!meta.ok) throw new Error(`Spotify playlist request failed (${meta.status})`)
  const info = await meta.json()

  // Spotify serves playlist contents from /items and returns each track under
  // `item`. The long-documented /tracks endpoint (track under `track`) now
  // answers 403 for newer apps, so try the working one first and keep the old
  // one as a fallback. Both shapes are read the same way below.
  for (const endpoint of ['items', 'tracks']) {
    const tracks = await collectTracks(playlistId, bearer, endpoint)
    if (tracks) return { name: info.name ?? 'Untitled playlist', tracks, source: `api/${endpoint}` }
  }

  throw new Error(
    'Spotify refused both playlist endpoints (/items and /tracks).\n' +
      '  If you are using SPOTIFY_TOKEN, it may have expired or lack playlist scope.',
  )
}

const PAGE_FIELDS = {
  items: 'items(item(id,name,artists(name),album(name,images))),next,total',
  tracks: 'items(track(id,name,artists(name),album(name,images))),next,total',
}

/** Page through one of the playlist-contents endpoints. Null = try the other. */
async function collectTracks(playlistId, bearer, endpoint) {
  const tracks = []
  let url =
    `https://api.spotify.com/v1/playlists/${playlistId}/${endpoint}` +
    `?limit=100&fields=${encodeURIComponent(PAGE_FIELDS[endpoint])}`

  while (url) {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
    if (!res.ok) {
      // Nothing collected yet: this endpoint isn't available to us at all.
      if (!tracks.length) return null
      throw new Error(`Spotify page request failed (${res.status}) after ${tracks.length} tracks`)
    }

    const page = await res.json()
    for (const entry of page.items ?? []) {
      const track = entry?.item ?? entry?.track
      if (!track?.id || !track.name) continue // local files, podcasts, removed tracks
      tracks.push({
        id: track.id,
        title: track.name,
        artist: (track.artists ?? []).map((a) => a.name).join(', '),
        album: track.album?.name ?? '',
        art: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? '',
      })
    }
    // Spotify drops the `fields` filter from its own next-page links; harmless,
    // the pages are just fatter and parsed identically.
    url = page.next
  }

  return tracks.length ? tracks : null
}

// --- youtube ---------------------------------------------------------------

async function searchWithApi(query, apiKey) {
  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video' +
    `&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(query)}&key=${apiKey}`
  const res = await fetchWithTimeout(url)
  if (res.status === 403) {
    const body = await res.text()
    throw new Error(
      `YouTube API refused the request (403). Usually the daily quota:\n` +
        `  search costs 100 units and the free tier is 10,000/day (~100 songs).\n` +
        `  Re-run later to resume — already-resolved tracks are cached.\n  ${body.slice(0, 200)}`,
    )
  }
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`)
  const data = await res.json()
  return data.items?.[0]?.id?.videoId ?? null
}

/** No API key? Read the ids straight off the public search results page. */
async function searchByScrape(query) {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  )
  if (!res.ok) return null
  const html = await res.text()
  const match = html.match(/"videoId":"([\w-]{11})"/)
  return match ? match[1] : null
}

/** Raised for conditions where continuing the run is pointless (e.g. quota). */
class FatalSearchError extends Error {}

/**
 * One song lookup, with retries.
 *
 * A dropped connection midway through 250 songs is normal; it should cost that
 * one track a retry, not abandon the rest. Only genuinely terminal conditions —
 * quota exhaustion — stop the run.
 *
 * An *empty* result needs care. On the scraping path it almost always means
 * YouTube served a throttled page with no results in it, not that the song is
 * missing, so it earns a backoff and another go. On the API path an empty
 * result is authoritative, and retrying would burn 100 quota units to be told
 * the same thing.
 */
async function resolveTrack(query, apiKey, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const found = await (apiKey ? searchWithApi(query, apiKey) : searchByScrape(query))
      if (found) return found
      if (apiKey) return null // authoritative: no such video
    } catch (err) {
      if (/\(403\)/.test(err.message)) throw new FatalSearchError(err.message)
    }
    if (attempt < attempts) await sleep(attempt * 1500 + Math.random() * 600)
  }
  return null
}

/** "Kehdoon Tumhen - From \"Deewaar\"" searches better as "Kehdoon Tumhen". */
function cleanTitle(title) {
  return title
    .replace(/\s*[-–]\s*From\s+".*?"\s*/gi, ' ')
    .replace(/\s*\((?:From|Original|Remastered)[^)]*\)\s*/gi, ' ')
    .trim()
}

// --- main ------------------------------------------------------------------

async function readExisting() {
  try {
    return JSON.parse(await readFile(PLAYLIST_PATH, 'utf8'))
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * How many song lookups run at once.
 *
 * Four is a deliberate compromise: six was measurably faster but tripped
 * YouTube's throttling often enough that a fifth of the playlist came back
 * empty and had to be retried anyway.
 */
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY ?? 4)
/** Save partial progress every this many completed lookups. */
const CHECKPOINT_EVERY = Number(process.env.SYNC_CHECKPOINT_EVERY ?? 25)

/** Atomic write, so a reader never catches a half-written playlist. */
async function writePlaylist(output) {
  await mkdir(dirname(PLAYLIST_PATH), { recursive: true })
  const temp = `${PLAYLIST_PATH}.tmp`
  await writeFile(temp, JSON.stringify(output, null, 2) + '\n')
  await rename(temp, PLAYLIST_PATH)
}

/**
 * Resolve every track to a video id, a batch at a time.
 *
 * Lookups are independent and almost entirely spent waiting on the network, so
 * running a handful concurrently turns a 250-song sync from ten minutes into
 * about one. Results are written back by position, so the playlist keeps its
 * Spotify order no matter what order the responses arrive in.
 *
 * Progress is checkpointed to disk along the way: a run that dies at song 200
 * leaves 200 songs playable rather than nothing.
 */
async function resolveAll({ tracks, cache, apiKey, name, playlistId, log }) {
  const resolved = new Array(tracks.length) // by index, to preserve order
  const queue = []

  tracks.forEach((track, index) => {
    const cached = cache.get(track.id)
    if (cached) resolved[index] = { ...track, ytId: cached }
    else queue.push(index)
  })

  const reused = tracks.length - queue.length
  if (reused) log(`  ${reused} already resolved, ${queue.length} to look up`)
  if (!queue.length) return { resolved: resolved.filter(Boolean), looked: 0, missed: 0, stoppedEarly: null }

  let cursor = 0
  let done = 0
  let missed = 0
  let sinceCheckpoint = 0
  let fatal = null

  const checkpoint = async () => {
    sinceCheckpoint = 0
    await writePlaylist({
      name,
      playlistId,
      syncedAt: new Date().toISOString(),
      partial: true,
      tracks: resolved.filter(Boolean),
    })
  }

  async function worker() {
    while (!fatal) {
      const index = cursor++
      if (index >= queue.length) return

      const position = queue[index]
      const track = tracks[position]
      const query = `${track.artist} ${cleanTitle(track.title)} audio`

      try {
        const ytId = await resolveTrack(query, apiKey)
        if (ytId) resolved[position] = { ...track, ytId }
        else {
          missed++
          log(`  no match: ${track.title}`)
        }
      } catch (err) {
        // Quota exhausted — stop every worker, but keep what we have.
        fatal = err.message
        log(`  ${err.message}`)
        return
      }

      done++
      sinceCheckpoint++
      if (done % 20 === 0) log(`  ${done}/${queue.length} looked up`)
      if (sinceCheckpoint >= CHECKPOINT_EVERY) await checkpoint()

      // Stagger the workers so we aren't a burst of parallel requests.
      if (!apiKey) await sleep(250 + Math.random() * 250)
    }
  }

  const workers = Math.max(1, Math.min(CONCURRENCY, queue.length))
  log(`  resolving with ${workers} parallel lookups`)
  await Promise.all(Array.from({ length: workers }, worker))

  return { resolved: resolved.filter(Boolean), looked: done, missed, stoppedEarly: fatal }
}

/**
 * Sync the playlist. Returns a summary; throws only if nothing could be saved.
 * `log` receives human-readable progress lines.
 */
export async function runSync({ playlist, log = () => {} } = {}) {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  const token = process.env.SPOTIFY_TOKEN
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN
  const apiKey = process.env.YOUTUBE_API_KEY
  const playlistId = parsePlaylistId(
    playlist || process.env.SPOTIFY_PLAYLIST || DEFAULT_PLAYLIST,
  )
  if (!playlistId) throw new Error('Could not parse a playlist id.')

  // Reuse video ids from the last run so re-syncing costs almost no quota.
  const existing = await readExisting()
  const cache = new Map(
    (existing?.tracks ?? []).filter((t) => t.ytId).map((t) => [t.id, t.ytId]),
  )

  log(`→ Spotify playlist ${playlistId}`)
  const canUseApi = Boolean(token || (clientId && clientSecret))
  // A client_credentials token (client id/secret with no refresh token) always
  // answers 403 on playlist reads — Spotify requires a user behind the token.
  // That combination can't ever succeed, so treat its failure as expected and
  // fall back to the embed instead of failing the whole run. A refresh token
  // or ready-made bearer token failing is a real error and still throws.
  const canFallBack = !token && !refreshToken
  let name, tracks, source, capped
  try {
    ;({ name, tracks, source, capped } = canUseApi
      ? await fetchViaApi(playlistId, { token, clientId, clientSecret, refreshToken })
      : await fetchViaEmbed(playlistId))
  } catch (err) {
    if (!canUseApi || !canFallBack) throw err
    log(`  ! Official API failed without a user token: ${err.message}`)
    log('    Falling back to the public embed (capped at 100 tracks).')
    ;({ name, tracks, source, capped } = await fetchViaEmbed(playlistId))
  }
  log(`  "${name}" — ${tracks.length} tracks (via ${source})`)

  if (capped) {
    log(
      '  ! The embed returns at most 100 tracks, so a longer playlist is cut off here.\n' +
        (canFallBack
          ? '    Add SPOTIFY_REFRESH_TOKEN ("npm run spotify-auth") to page through all of it.'
          : '    Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to page through all of it.'),
    )
  }

  const { resolved, looked, missed, stoppedEarly } = await resolveAll({
    tracks,
    cache,
    apiKey,
    name,
    playlistId,
    log,
  })

  if (!resolved.length) {
    throw new Error('Nothing resolved — leaving the existing playlist.json alone.')
  }

  // Two Spotify entries can land on the same video — a single and its album
  // cut, a remaster, or simply a search that matched the same upload twice.
  // Left in, the radio plays that audio twice per pass, which is exactly what
  // shuffling is supposed to prevent. Keep the first, drop the rest.
  const seen = new Set()
  const unique = resolved.filter((track) => {
    if (seen.has(track.ytId)) return false
    seen.add(track.ytId)
    return true
  })
  const deduped = resolved.length - unique.length
  if (deduped) log(`  ${deduped} duplicate video${deduped === 1 ? '' : 's'} dropped`)

  const output = {
    name,
    playlistId,
    syncedAt: new Date().toISOString(),
    tracks: unique,
  }
  await writePlaylist(output)

  const summary = {
    name,
    total: tracks.length,
    playable: unique.length,
    lookedUp: looked,
    unmatched: missed,
    duplicates: deduped,
    syncedAt: output.syncedAt,
    stoppedEarly,
    capped: Boolean(capped),
  }
  log(
    `\n✓ ${unique.length} playable tracks → data/playlist.json` +
      ` (${looked} new lookups, ${missed} unmatched)`,
  )
  return summary
}

// --- cli -------------------------------------------------------------------

