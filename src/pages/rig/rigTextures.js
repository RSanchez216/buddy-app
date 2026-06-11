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
    ctx.fillText(name.toLowerCase(), w / 2, h / 2)
  })
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}
