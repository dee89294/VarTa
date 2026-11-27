/**
 * File: vite.config.ts
 * Purpose: Configures the Vite bundler, React JSX/Fast-Refresh plugin, and Tailwind CSS v4 integration.
 * Why required: Compiles TypeScript/TSX modules in `src/` and injects Tailwind utility styles from `src/index.css`.
 * Connected files:
 *   - `package.json` (`dev` and `build` scripts invoke Vite using this config)
 *   - `index.html` (HTML entry point served and bundled by Vite)
 *   - `src/main.tsx` (root React entry module)
 *   - `src/index.css` (processed via `@tailwindcss/vite`)
 * Impact if modified/removed: Removing React or Tailwind plugins breaks JSX compilation or strips all UI styling.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
