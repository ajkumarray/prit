#!/usr/bin/env node
/**
 * One-time helper: turns your Spotify app into a refresh token.
 *
 *   npm run spotify-auth
 *
 * Why this exists: Spotify's client_credentials flow authenticates fine and
 * then answers 403 on every playlist track endpoint, because an app-only token
 * has no user behind it. Reading a playlist — even your own, even a public one
 * — needs a user-authorized token. Access tokens last an hour; the refresh
 * token you get here does not expire, and mints fresh ones forever.
 *
 * Before running, add this exact redirect URI to your app at
 * developer.spotify.com/dashboard → Settings → Redirect URIs:
 *
 *   http://127.0.0.1:8888/callback
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const PORT = 8888
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
const SCOPES = 'playlist-read-private playlist-read-collaborative'

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

const clientId = process.env.SPOTIFY_CLIENT_ID
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.')
  process.exit(1)
}

const state = Math.random().toString(36).slice(2)
const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  })

console.log('\nOpen this in a browser and approve:\n')
console.log(`  ${authUrl}\n`)
console.log(`Waiting for the redirect back to ${REDIRECT_URI} …\n`)

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not here')
    return
  }

  const finish = (message) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<body style="font:16px system-ui;padding:40px">${message}</body>`)
  }

  if (url.searchParams.get('state') !== state) {
    finish('State mismatch — start over.')
    console.error('State mismatch. Aborting.')
    server.close()
    process.exit(1)
  }

  const error = url.searchParams.get('error')
  if (error) {
    finish(`Spotify said: ${error}`)
    console.error(`\nAuthorization failed: ${error}`)
    server.close()
    process.exit(1)
  }

  const code = url.searchParams.get('code')
  const token = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })

  if (!token.ok) {
    const detail = await token.text()
    finish('Token exchange failed — check the terminal.')
    console.error(`\nToken exchange failed (${token.status}):\n${detail}`)
    server.close()
    process.exit(1)
  }

  const { refresh_token: refreshToken } = await token.json()
  finish('Done. You can close this tab and go back to the terminal.')

  console.log('Add this to .env, and to the repo secrets as SPOTIFY_REFRESH_TOKEN:\n')
  console.log(`SPOTIFY_REFRESH_TOKEN=${refreshToken}\n`)
  console.log('It does not expire. Keep it out of git.')

  server.close()
  process.exit(0)
})

server.listen(PORT)
