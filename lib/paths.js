import { resolve } from 'node:path'

/**
 * Where the synced track list lives.
 *
 * Resolved from the working directory rather than import.meta.url so it points
 * at the repo in every context that needs it: the CLI, a Next.js route handler
 * running from a bundled build, and the GitHub Actions runner.
 */
export const PLAYLIST_PATH = resolve(process.cwd(), 'data/playlist.json')
