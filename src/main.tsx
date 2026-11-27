/**
 * File: src/main.tsx
 * Purpose: Browser entry point that mounts the React application into the `#root` DOM node.
 * Why required: Initializes React StrictMode, loads global Tailwind + custom dark-theme CSS (`src/index.css`),
 *   and renders the root `<App />` router and providers.
 * Connected files:
 *   - `index.html` (loads `/src/main.tsx` and provides `<div id="root">`)
 *   - `src/index.css` (global dark charcoal canvas, glass cards, scrollbar, and reduced-motion styles)
 *   - `src/App.tsx` (provides AuthProvider, ToastProvider, MotionConfig, and BrowserRouter)
 * Impact if modified/removed: The React application will fail to mount or render without global styles.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
