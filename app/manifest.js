export default function manifest() {
  return {
    name: 'Prit Radio',
    short_name: 'Prit',
    description: 'An always-on radio for the Prit playlist. Press play, let it run.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#171210',
    theme_color: '#171210',
    categories: ['music', 'entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops to the launcher's shape; the artwork keeps its content
      // inside the safe circle so this is the same file.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
