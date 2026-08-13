import { NextResponse } from 'next/server'
import { readPlaylist } from '../../../lib/playlist.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const playlist = await readPlaylist()
  // Always fresh — a cached copy here would undo the point of syncing.
  return NextResponse.json(playlist, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
