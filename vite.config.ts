import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: true,
    // Camera requires a secure context. On a phone over LAN use `npm run dev -- --https`
    // or tunnel (e.g. `npx localtunnel --port 5173`) — http://<lan-ip> will NOT get camera access.
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep the ~7MB vision wasm/runtime out of the initial shell so the app
          // opens fast on 3G and only workout pages pay for the CV bundle.
          vision: ['@mediapipe/tasks-vision'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate'. autoUpdate reloads the page the moment a new
      // service worker activates — which is how you lose a set of push-ups to a
      // deploy. The app now asks first (see components/UpdatePrompt.tsx).
      registerType: 'prompt',
      // We register the SW ourselves from the React tree so the prompt can be
      // wired to it; the auto-injected script would register a second time.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Showup — daily challenges',
        short_name: 'Showup',
        description: 'Create a challenge. Invite your people. Show up every day.',
        theme_color: '#0B0F14',
        background_color: '#0B0F14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        id: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,

        // Serves the precached shell for any route, so the installed app opens
        // and deep links resolve with no connection. The plugin defaults this
        // on; it is stated explicitly because it is load-bearing for a SPA and
        // should not silently change with a plugin upgrade.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /\/[^/?]+\.[^/]+$/],

        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Never skip waiting on our own: the update prompt decides when.
        skipWaiting: false,

        runtimeCaching: [
          {
            // MediaPipe wasm + the pose model, served from the CDN.
            // CacheFirst so a workout works fully offline after the first run.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe-runtime',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-model',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase reads: network first, but a cached copy keeps the
            // leaderboard on screen when the connection drops mid-session.
            urlPattern: /\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'supabase-reads',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
