#!/usr/bin/env node
/**
 * Command-line wrapper around the sync.
 *
 *   npm run sync
 *   npm run sync -- https://open.spotify.com/playlist/YOUR_PLAYLIST_ID
 *
 * Kept separate from sync-playlist.mjs so that reading .env — a dynamic
 * filesystem access — never ends up in the import graph of an API route.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runSync } from './sync-playlist.mjs'

/** A four-key .env reader, so the CLI needs no dependency to match Next.js. */
async function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    let raw
    try {
      raw = await readFile(resolve(process.cwd(), file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const value = match[2].replace(/^["']|["']$/g, '')
      if (value && !process.env[match[1]]) process.env[match[1]] = value
    }
  }
}

await loadEnv()

try {
  await runSync({ playlist: process.argv[2], log: (line) => console.log(line) })
} catch (err) {
  console.error(`\n${err.message}`)
  process.exit(1)
}
