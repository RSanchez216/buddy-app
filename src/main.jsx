import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initChunkReload, startBuildWatch } from './lib/chunkReload'

// Auto-recover from stale Vite chunks after a deploy (vite:preloadError +
// loop-guarded reload).
initChunkReload()
// Proactively detect a newer deploy and show the refresh banner BEFORE the user
// acts on stale code (polls index.html; never auto-reloads on this path).
startBuildWatch()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
