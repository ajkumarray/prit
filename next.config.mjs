/** @type {import('next').NextConfig} */
const nextConfig = {
  // Render runs this as a long-lived Node process.
  output: 'standalone',
  images: {
    // Album art comes from Spotify's CDN; thumbnails from YouTube's.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
}

export default nextConfig
