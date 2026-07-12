import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initChunkReload } from './lib/chunkReload'

// Auto-recover from stale Vite chunks after a deploy (vite:preloadError +
// loop-guarded reload).
initChunkReload()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
