import Radio from '../components/Radio.jsx'
import { readPlaylist } from '../lib/playlist.js'

// Read the playlist per request, so a fresh sync shows up on reload.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const playlist = await readPlaylist()
  return <Radio playlist={playlist} />
}
