import { NextResponse } from 'next/server'
import { runSync } from '../../../scripts/sync-playlist.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A full sync of a fresh playlist walks every track; give it room.
export const maxDuration = 300

// A public button shouldn't let anyone hammer YouTube on our behalf.
const COOLDOWN_MS = Number(process.env.SYNC_COOLDOWN_MS ?? 10 * 60 * 1000)
const SYNC_TOKEN = process.env.SYNC_TOKEN ?? ''

// Module scope survives between requests in a long-running server, which is
// what Render gives us. Single instance, so this is enough to serialise.
let inFlight = null
let lastFinishedAt = 0
let lastRun = null

const cooldownRemaining = () => Math.max(0, COOLDOWN_MS - (Date.now() - lastFinishedAt))

/** Single-flight: concurrent callers join the run already in progress. */
function startSync(trigger) {
  if (inFlight) return inFlight

  const started = Date.now()
  inFlight = runSync({ log: (line) => console.log(`[sync] ${line}`) })
    .then((summary) => {
      lastRun = {
        ...summary,
        trigger,
        ok: true,
        seconds: Math.round((Date.now() - started) / 1000),
      }
      return lastRun
    })
    .catch((err) => {
      lastRun = { trigger, ok: false, error: err.message }
      throw err
    })
    .finally(() => {
      inFlight = null
      lastFinishedAt = Date.now()
    })

  return inFlight
}

export async function GET() {
  return NextResponse.json(
    {
      syncing: Boolean(inFlight),
      cooldownMs: cooldownRemaining(),
      lastRun,
      requiresToken: Boolean(SYNC_TOKEN),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request) {
  if (SYNC_TOKEN && request.headers.get('x-sync-token') !== SYNC_TOKEN) {
    return NextResponse.json({ error: 'Bad or missing sync token.' }, { status: 401 })
  }
  if (inFlight) {
    return NextResponse.json(
      { error: 'A sync is already running.', syncing: true },
      { status: 409 },
    )
  }

  const wait = cooldownRemaining()
  if (wait > 0) {
    return NextResponse.json(
      {
        error: `Synced recently — try again in ${Math.ceil(wait / 1000)}s.`,
        cooldownMs: wait,
      },
      { status: 429 },
    )
  }

  try {
    const summary = await startSync('manual')
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
