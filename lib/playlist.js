import { readFile } from 'node:fs/promises'
import { PLAYLIST_PATH } from './paths.js'

const EMPTY = { name: 'Prit', tracks: [], syncedAt: null }

/** Read the synced track list off disk. Never throws — an empty list renders. */
export async function readPlaylist() {
  try {
    const parsed = JSON.parse(await readFile(PLAYLIST_PATH, 'utf8'))
    return {
      ...EMPTY,
      ...parsed,
      tracks: (parsed.tracks ?? []).filter((track) => track?.ytId),
    }
  } catch {
    return EMPTY
  }
}
