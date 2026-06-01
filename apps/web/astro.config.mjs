// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  vite: {
      optimizeDeps: {
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      },
	},

  adapter: cloudflare(),
})