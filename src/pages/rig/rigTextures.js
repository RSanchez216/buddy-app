// Canvas-generated textures for The Rig — asphalt speckle, lane dashes,
// flatbed planks, reflective tape, and the customer-trailer wordmark.
// All cheap one-time draws; no image fetches beyond the MANAS logo PNG.

import * as THREE from 'three'

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d'), width, height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

export function makeAsphaltTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#101218'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 2600; i++) {
      const g = 12 + Math.random() * 28
      ctx.fillStyle = `rgba(${g},${g},${g + 5},${0.2 + Math.random() * 0.5})`
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
    }
  })
  tex.repeat.set(56, 56)
  return tex
}

// One dash per tile; the strip mesh sets repeat along its length.
export function makeLaneDashTexture() {
  return canvasTexture(32, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#e8edf6'
    ctx.fillRect(4, 84, w - 8, 88)
  })
}

export function makePlankTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const boards = 8
    const bw = w / boards
    for (let b = 0; b < boards; b++) {
      const l = 30 + Math.random() * 16
      ctx.fillStyle = `rgb(${l + 62},${l + 32},${l + 6})`
      ctx.fillRect(b * bw, 0, bw, h)
      // grain
      ctx.strokeStyle = 'rgba(20,12,4,0.25)'
      for (let i = 0; i < 5; i++) {
        const x = b * bw + 3 + Math.random() * (bw - 6)
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x + (Math.random() - 0.5) * 6, h)
        ctx.stroke()
      }
      // board end seam
      ctx.fillStyle = 'rgba(15,9,3,0.7)'
      ctx.fillRect(b * bw, Math.random() * h, bw, 3)
      // gap between boards
      ctx.fillRect(b * bw, 0, 2, h)
    }
  })
  tex.repeat.set(1, 7)
  return tex
}

export function makeReflectiveTapeTexture() {
  const tex = canvasTexture(256, 32, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#d9dee4' : '#b3242a'
      ctx.fillRect(i * (w / 8), 0, w / 8, h)
    }
  })
  tex.repeat.set(6, 1)
  return tex
}

// Flat text wordmark only — deliberately NOT the Amazon smile/Prime artwork.
export function makeCustomerWordmarkTexture(name) {
  const tex = canvasTexture(1024, 192, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#f4f8fb'
    ctx.font = '700 96px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, w / 2, h / 2)
  })
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

// Full-side MANAS trailer wrap: red/black sweeping bands + circular
// MANAS EXPRESS badge (recreates the user's wrap concept; drawn flat,
// the van wall is flat so it reads faithfully).
export function makeTrailerWrapTexture() {
  const W = 2048
  const H = 512
  const tex = canvasTexture(W, H, (ctx, w, h) => {
    // opaque white field (matches the van body; transparent canvases
    // darken the wall through mipmap fringe at distance)
    ctx.fillStyle = '#e8ebee'
    ctx.fillRect(0, 0, w, h)

    // sweeping bands rising from bottom-left toward the upper right
    const bands = [
      { color: '#16181d', width: 64, lift: 0 },
      { color: '#c0242b', width: 78, lift: 90 },
      { color: '#16181d', width: 48, lift: 175 },
      { color: '#c0242b', width: 40, lift: 240 },
    ]
    for (const b of bands) {
      ctx.strokeStyle = b.color
      ctx.lineWidth = b.width
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-80, h - 40 - b.lift * 0.4)
      ctx.bezierCurveTo(w * 0.3, h - 60 - b.lift, w * 0.6, h * 0.55 - b.lift, w + 80, -60 - b.lift * 0.3)
      ctx.stroke()
    }

    // circular badge, centered
    const cx = w / 2
    const cy = h * 0.42
    const r = 138
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#f6f8fa'
    ctx.fill()
    ctx.lineWidth = 14
    ctx.strokeStyle = '#c0242b'
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#16181d'
    ctx.font = '800 64px Arial, sans-serif'
    ctx.fillText('MANAS', cx, cy - 28)
    ctx.fillStyle = '#c0242b'
    ctx.font = 'italic 800 52px Arial, sans-serif'
    ctx.fillText('EXPRESS', cx, cy + 36)
    ctx.strokeStyle = '#c0242b'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(cx - 100, cy + 72)
    ctx.lineTo(cx + 100, cy + 72)
    ctx.stroke()

    // small repeated badges along the lower rail
    ctx.font = '800 30px Arial, sans-serif'
    for (let x = 180; x < w; x += 420) {
      if (Math.abs(x - cx) < 260) continue
      ctx.beginPath()
      ctx.arc(x - 70, h - 70, 26, 0, Math.PI * 2)
      ctx.fillStyle = '#c0242b'
      ctx.fill()
      ctx.fillStyle = '#16181d'
      ctx.textAlign = 'left'
      ctx.fillText('MANAS', x - 34, h - 80)
      ctx.fillStyle = '#c0242b'
      ctx.font = 'italic 800 24px Arial, sans-serif'
      ctx.fillText('EXPRESS', x - 34, h - 52)
      ctx.font = '800 30px Arial, sans-serif'
    }
    ctx.textAlign = 'center'
  })
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 8
  return tex
}

// Thin tapered red accent swoosh for the cab's upper sleeper line
// (design-1 reference). Transparent strip, drawn fat-left → thin-right.
export function makeAccentStripeTexture() {
  const tex = canvasTexture(512, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#c0242b'
    ctx.beginPath()
    ctx.moveTo(0, h * 0.15)
    ctx.bezierCurveTo(w * 0.4, h * 0.05, w * 0.7, h * 0.25, w, h * 0.42)
    ctx.lineTo(w, h * 0.58)
    ctx.bezierCurveTo(w * 0.7, h * 0.55, w * 0.4, h * 0.95, 0, h * 0.85)
    ctx.closePath()
    ctx.fill()
  })
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

// Lit-window grid for city silhouettes; doubles as map + emissiveMap so the
// windows glow at night (emissiveIntensity animated with the day cycle).
export function makeWindowsTexture() {
  const tex = canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#070a10'
    ctx.fillRect(0, 0, w, h)
    for (let y = 6; y < h - 4; y += 8) {
      for (let x = 4; x < w - 4; x += 8) {
        if (Math.random() < 0.55) {
          ctx.fillStyle = Math.random() < 0.8 ? '#f0c98a' : '#bcd2e8'
          ctx.fillRect(x, y, 3, 4)
        }
      }
    }
  })
  return tex
}
