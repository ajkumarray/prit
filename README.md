# Prit Radio

An always-on radio page for the [Prit](https://open.spotify.com/playlist/0BYFO12JqbeR5S2sWTUjRU)
playlist. It takes the *track list* from Spotify and plays each song through a
hidden YouTube player. Three controls, nothing else: **play, pause, next**.

```bash
npm install
npm run dev
```

Next.js (App Router) + Tailwind. No database, no credentials required.

> **Currently capped at 100 tracks.** Sync doesn't have a working
> `SPOTIFY_REFRESH_TOKEN` (see below), so it runs on Spotify's public embed
> page instead of the official API — which returns at most the first 100
> tracks of the Prit playlist's 256. Every sync (nightly and manual) will
> stay capped until a refresh token is added.

## How it works

Spotify has no API for *playing* audio you don't own, and its playlist API can't
be called from a browser anyway — the Client Credentials flow needs a client
secret. YouTube's search API is capped at roughly 100 songs a day on the free
tier, so resolving songs at playback time would break almost immediately.

So the work is split into two halves that meet at a JSON file:

```
scripts/sync-playlist.mjs   →   data/playlist.json   →   the app
   (occasionally)                 (committed)            (every visit)
```

1. **Sync.** Reads the playlist from Spotify, finds a matching YouTube video for
   each track, writes `data/playlist.json`.
2. **Runtime.** The page reads that file and plays it. It never calls Spotify or
   YouTube's APIs, and holds no credentials.

Re-running sync reuses video ids resolved on previous runs, so only genuinely new
songs cost a lookup.

### Reading Spotify without an API key

By default sync reads the playlist off Spotify's **public embed page** — the same
data the embeddable player uses. No app registration, no secret, no quota.

**The embed stops at 100 tracks.** The Prit playlist has 256, so to get all of
it you need the official API — and that takes three things, not two:

1. **An app.** [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
   Add `http://127.0.0.1:8888/callback` under Settings → Redirect URIs.
2. **Client ID and secret**, into `.env`.
3. **A refresh token** — `npm run spotify-auth`, approve in the browser, paste
   the printed value into `.env`.

Step 3 is not optional, and it's the part that surprises people:

> **client_credentials cannot read playlists.** An app-only token authenticates
> perfectly — `200` from `/api/token` — and then answers **403 Forbidden** on
> every playlist track endpoint, including for a public playlist you own
> yourself. There's no user behind the token, and Spotify now requires one.

`npm run spotify-auth` runs the authorization-code flow once against a local
callback and prints a refresh token. Access tokens last an hour; the refresh
token doesn't expire, and sync trades it for a fresh access token on each run.

For the nightly job, add all three to the repo's **Settings → Secrets → Actions**:
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`. Without
the third, the workflow falls back to the 100-track embed — which is this
repo's current state: the first two are set, the refresh token isn't.

There's also `SPOTIFY_TOKEN` for a ready-made bearer token, handy for a one-off
run — but these expire within the hour, so don't build on one. Sync says so
explicitly if it gets a 401.

### Careful: it's `/items`, not `/tracks`

The endpoint every Spotify tutorial names — `GET /v1/playlists/{id}/tracks` —
answers **403 Forbidden** for newer apps, even for a playlist you own, with a
token that works fine on `/me` and on the playlist's own metadata. The working
endpoint is `/v1/playlists/{id}/items`, and it nests each track under `item`
rather than `track`.

Sync tries `/items` first and falls back to `/tracks`, reading either shape, so
it keeps working whichever one your credentials are allowed to use. If you ever
see a bare `403 Forbidden` from Spotify while the rest of the API behaves, this
is almost certainly why.

### Lookups run in batches

Resolving a song is almost all network waiting, so lookups run **6 at a time**
(`SYNC_CONCURRENCY`) rather than one after another — the difference between about
ten minutes and about one on a 250-song playlist. Results are written back by
position, so the playlist keeps its Spotify order regardless of which responses
land first.

Progress is checkpointed to disk every 25 lookups (`SYNC_CHECKPOINT_EVERY`), so a
run that dies partway leaves the songs it did resolve playable instead of
nothing. Every request has a 15-second timeout (`SYNC_REQUEST_TIMEOUT_MS`) so a
stalled connection can't hang the nightly job, and each track gets three attempts
before being skipped.

Raise `SYNC_CONCURRENCY` if syncs feel slow; lower it if YouTube starts returning
empty results, which is the shape rate-limiting takes here.

## Syncing

Three ways to run it, all the same code path:

| | When | Writes to |
| --- | --- | --- |
| **Nightly** | GitHub Actions, 00:00 IST | a commit on `master` |
| **Sync button** | whenever you press it | the running server's disk |
| **`npm run sync`** | locally | your working copy |

### Why the schedule lives in GitHub Actions

Render's free tier sleeps a service after ~15 minutes idle, and its disk is
ephemeral. A cron *inside* the app would silently stop firing while asleep, and
anything it wrote would vanish on the next deploy.

So [`.github/workflows/sync-playlist.yml`](.github/workflows/sync-playlist.yml)
owns the schedule instead. It runs at 18:30 UTC (00:00 IST), commits
`data/playlist.json` to `master`, and that push triggers Render's auto-deploy.
The playlist lives in git, so it survives restarts and never depends on the
service being awake.

Two things to know: GitHub cron has no timezone support (hence UTC) and can fire
a few minutes late under load; and GitHub disables scheduled workflows after 60
days with no repo activity — the nightly commit normally keeps it alive on its
own.

You can also trigger it by hand from the repo's **Actions** tab.

### The sync button

Top-right of the page. It calls `POST /api/sync`, which runs the same sync in the
running server and refreshes the page. Useful for picking up a song you just
added without waiting for midnight.

It writes to the server's local disk, so on Render it lasts until the next
deploy — after which the committed version takes over. That's fine: the nightly
run makes git canonical again.

It's rate-limited to one run per 10 minutes (`SYNC_COOLDOWN_MS`) and
single-flighted. **It's open to any visitor by default** — set `SYNC_TOKEN` in
the Render dashboard if you'd rather lock it down.

## Deploying to Render

The repo includes [`render.yaml`](render.yaml), so:

1. Push to GitHub with `master` as the default branch.
2. In Render: **New → Blueprint**, pick the repo. It reads `render.yaml`.
3. Deploy. Auto-deploy on `master` is on, so the nightly sync commit redeploys.

Free tier caveat: the service sleeps when idle, so the first visit after a quiet
spell takes ~30 seconds to wake. Playback is unaffected once loaded — audio comes
from YouTube, not from Render.

For the workflow to push, no extra secrets are needed (`GITHUB_TOKEN` is
automatic). Add repo secrets only if you want the official Spotify API or a
YouTube key.

## Layout

| Path | What it is |
| --- | --- |
| `scripts/sync-playlist.mjs` | Spotify → YouTube resolver. Dependency-free; also importable. |
| `data/playlist.json` | Generated track list. Committed. |
| `app/page.jsx` | Server component; reads the playlist per request. |
| `app/api/sync/route.js` | The sync button's endpoint — cooldown + single-flight. |
| `app/api/playlist/route.js` | Current track list as JSON. |
| `components/Radio.jsx` | The page — hero, status light, player bar, sync button. |
| `lib/useRadio.js` | Wraps the YouTube IFrame player: play, pause, next, auto-advance. |

Keyboard: **space** toggles play, **→** skips, **←** goes back.

## The player

Transport is previous / play-pause / next, with a seek bar, elapsed and total
time, and a volume slider.

**Previous does the expected two things.** More than 3 seconds into a song it
restarts that song; before that it steps back a track. That's what every music
player does, and what the hand reaches for.

**Seeking commits on release**, not on every pixel of the drag — otherwise a
scrub across the bar fires a hundred `seekTo` calls at the player. While you're
dragging, the polled position is ignored so the handle can't jump out from under
your finger.

The YouTube IFrame API has no `timeupdate` event, so position is polled four
times a second, and only while something is playing.

**Volume is desktop only.** Phones have hardware volume keys, and iOS ignores
programmatic volume entirely — a slider there would be a control that does
nothing. The chosen level is remembered in `localStorage` (read after mount, so
it can't break hydration).

## Installing it

The site is a PWA, so it can go on a phone's home screen or a desktop dock and
open without browser chrome. An **install** button appears in the header when
the browser offers it.

Four pieces make that work:

| Piece | Why |
| --- | --- |
| `app/manifest.js` | Name, colours, icons, `display: standalone` |
| `public/sw.js` | **Chrome refuses to offer install without a service worker that handles fetch.** Also gives a usable offline shell. |
| `public/icon-*.png` | 192 and 512, generated by `npm run icons` |
| `components/InstallButton.jsx` | Captures `beforeinstallprompt`, fires it on click |

**iOS has no programmatic install.** Safari never fires `beforeinstallprompt`,
so it gets a short "Share → Add to Home Screen" hint instead of a button that
would do nothing. The button hides entirely when the app is already installed,
or on browsers that can't install at all.

### Testing it locally

The service worker only registers in production — one in front of the dev
server fights hot reload. So:

```bash
npm run build && npm start
```

Install prompts also need HTTPS, with `localhost` the one exception. On Render
you get HTTPS automatically.

### The icons

Generated rather than committed as opaque binaries, so they stay editable —
edit the drawing in `scripts/make-icons.mjs` and re-run `npm run icons`. It uses
a small PNG encoder over `node:zlib`, so there's no image dependency. The mark
is a heart inside a radio wave, kept inside the maskable safe circle so Android
can crop it to any launcher shape without clipping.

### What the service worker will and won't cache

It caches the shell and content-hashed build output. It deliberately **never**
touches `/api/*` — serving a stale track list would undo the point of syncing —
and never touches other origins, so YouTube's player and Spotify's album art are
left completely alone.

## Shuffle

Always on — there's no ordered mode. It isn't "pick a random song each time",
which repeats songs and leaves others unplayed for hours. The whole playlist is
dealt into a shuffled running order and played through; at the end it reshuffles
for the next pass, avoiding opening with the song that just closed the previous
one. **Every song plays once before any plays twice.**

The counter in the header (`7 / 100`) is your position in the current pass, not
the playlist index.

The shuffle happens on the client after hydration, so the server-rendered HTML
stays deterministic. A sync that changes the playlist re-deals the order but
slots the currently-playing song into the current position, so it never cuts off
mid-song.

## Song matching

Matching is a search, so it's occasionally wrong — a live version, a cover, a
remix. Fix one by editing its `ytId` in `data/playlist.json`; sync caches by
Spotify track id and won't overwrite your correction on later runs.

## A note on rights

Audio streams from YouTube's embedded player; nothing is hosted here, and rights
stay with the labels, composers and performers.
