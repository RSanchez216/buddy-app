/* eslint-disable react-hooks/immutability -- a three.js scene graph is
   imperatively mutated by design (fog, light colors, texture offsets, wheel
   rotations are per-frame mutations); the rule models React state, not GL. */
/*
 * The Rig — interactive 3D company-health scene.
 *
 * Models are free community assets from Sketchfab (CC Attribution),
 * compressed with gltf-transform (draco + webp, node hierarchy preserved):
 *  - /models/tractor.glb        — "Freightliner Cascadia 2020"
 *                                 TODO: fill exact Sketchfab author credit
 *  - /models/trailer-dryvan.glb — "Truck Trailer Free"
 *                                 TODO: fill exact Sketchfab author credit
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Decal,
  Environment,
  Html,
  OrbitControls,
  useGLTF,
  useTexture,
} from '@react-three/drei'
import {
  DAY_NIGHT_PERIOD,
  MANAS_LOGO_URL,
  MOCK_TOP_CUSTOMER,
  RIG_STATES,
  TRACTOR_URL,
  TRAILER_GROUP_Z,
  TRAILER_SCALE,
  TRAILER_URL,
  WHEEL_RADIUS,
} from './rigConfig'
import {
  makeAccentStripeTexture,
  makeAsphaltTexture,
  makeCustomerWordmarkTexture,
  makeLaneDashTexture,
  makePlankTexture,
  makeReflectiveTapeTexture,
  makeTrailerWrapTexture,
  makeWindowsTexture,
} from './rigTextures'

useGLTF.preload(TRACTOR_URL)
useGLTF.preload(TRAILER_URL)
useTexture.preload(MANAS_LOGO_URL)

const DAMP = 2.4 // ≈96% settled in ~1.5s

// Deterministic pseudo-random for scenery layout (stable across renders,
// keeps the render pure for the react-hooks lint).
function rnd(seed) {
  return Math.abs(Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1
}

/* ------------------------------------------------------------------ */
/* Atmosphere: fog, background, lights, env intensity — health-state   */
/* targets lerped over ~1.5s, then modulated by a slow day/night cycle */
/* so the rig drives through daylight and darkness.                    */
/* ------------------------------------------------------------------ */
function Atmosphere({ rigState, animRef }) {
  const scene = useThree((s) => s.scene)
  const keyRef = useRef()
  const rimRef = useRef()
  const hemiRef = useRef()

  const cur = useRef(null)
  if (cur.current === null) {
    const s = RIG_STATES[rigState]
    cur.current = {
      bg: new THREE.Color(s.bg),
      fogColor: new THREE.Color(s.fogColor),
      fogNear: s.fogNear,
      fogFar: s.fogFar,
      keyColor: new THREE.Color(s.keyColor),
      keyIntensity: s.keyIntensity,
      rimColor: new THREE.Color(s.rimColor),
      rimIntensity: s.rimIntensity,
      hemiIntensity: s.hemiIntensity,
      envIntensity: s.envIntensity,
      laneSpeed: s.laneSpeed,
      bobAmp: s.bobAmp,
      bobFreq: s.bobFreq,
      tilt: s.tilt,
      shudder: s.shudder,
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) window.__rigScene = scene // debug/verification hook, dev only
    const fog = new THREE.Fog(cur.current.fogColor.clone(), cur.current.fogNear, cur.current.fogFar)
    scene.fog = fog
    scene.background = cur.current.bg.clone()
    return () => {
      scene.fog = null
      scene.background = null
    }
  }, [scene])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const t = RIG_STATES[rigState]
    const c = cur.current
    const k = 1 - Math.exp(-DAMP * dt)

    c.bg.lerp(_tmpColor.set(t.bg), k)
    c.fogColor.lerp(_tmpColor.set(t.fogColor), k)
    c.fogNear = THREE.MathUtils.damp(c.fogNear, t.fogNear, DAMP, dt)
    c.fogFar = THREE.MathUtils.damp(c.fogFar, t.fogFar, DAMP, dt)
    c.keyColor.lerp(_tmpColor.set(t.keyColor), k)
    c.keyIntensity = THREE.MathUtils.damp(c.keyIntensity, t.keyIntensity, DAMP, dt)
    c.rimColor.lerp(_tmpColor.set(t.rimColor), k)
    c.rimIntensity = THREE.MathUtils.damp(c.rimIntensity, t.rimIntensity, DAMP, dt)
    c.hemiIntensity = THREE.MathUtils.damp(c.hemiIntensity, t.hemiIntensity, DAMP, dt)
    c.envIntensity = THREE.MathUtils.damp(c.envIntensity, t.envIntensity, DAMP, dt)
    c.laneSpeed = THREE.MathUtils.damp(c.laneSpeed, t.laneSpeed, DAMP, dt)
    c.bobAmp = THREE.MathUtils.damp(c.bobAmp, t.bobAmp, DAMP, dt)
    c.bobFreq = THREE.MathUtils.damp(c.bobFreq, t.bobFreq, DAMP, dt)
    c.tilt = THREE.MathUtils.damp(c.tilt, t.tilt, DAMP, dt)
    c.shudder = THREE.MathUtils.damp(c.shudder, t.shudder, DAMP, dt)

    // Day/night: cosine cycle starting at full day. Night darkens the
    // state's look (never brightens it), so stalling stays grim.
    const day = 0.5 + 0.5 * Math.cos((clock.elapsedTime / DAY_NIGHT_PERIOD) * Math.PI * 2)
    const bright = 0.35 + 0.65 * day
    animRef.current.night = 1 - day

    if (scene.fog) {
      scene.fog.color.copy(c.fogColor).multiplyScalar(bright)
      scene.fog.near = c.fogNear
      scene.fog.far = c.fogFar
    }
    if (scene.background?.isColor) scene.background.copy(c.bg).multiplyScalar(bright)
    scene.environmentIntensity = c.envIntensity * (0.3 + 0.7 * day)
    if (keyRef.current) {
      keyRef.current.color.copy(c.keyColor)
      keyRef.current.intensity = c.keyIntensity * bright
    }
    if (rimRef.current) {
      rimRef.current.color.copy(c.rimColor)
      rimRef.current.intensity = c.rimIntensity
    }
    if (hemiRef.current) hemiRef.current.intensity = c.hemiIntensity * bright

    animRef.current.speed = c.laneSpeed
    animRef.current.bobAmp = c.bobAmp
    animRef.current.bobFreq = c.bobFreq
    animRef.current.tilt = c.tilt
    animRef.current.shudder = c.shudder
  })

  return (
    <>
      <directionalLight
        ref={keyRef}
        position={[9, 13, 7]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
      />
      <directionalLight ref={rimRef} position={[-11, 6, -16]} />
      <hemisphereLight ref={hemiRef} args={['#27344c', '#06070c']} />
      <Suspense fallback={null}>
        <Environment preset={RIG_STATES[rigState].envPreset} background={false} />
      </Suspense>
    </>
  )
}
const _tmpColor = new THREE.Color()

/* ------------------------------------------------------------------ */
/* Road: asphalt plane + animated dashed lane lines + solid edge lines */
/* ------------------------------------------------------------------ */
function Road({ animRef }) {
  const asphalt = useMemo(() => makeAsphaltTexture(), [])
  const dash = useMemo(() => {
    const t = makeLaneDashTexture()
    t.repeat.set(1, 40)
    return t
  }, [])
  const DASH_TILE = 6 // meters of road per dash tile (240 / 40)

  useFrame((_, dt) => {
    // Rig faces +z and drives forward: the road flows backward past it,
    // so the dash pattern scrolls toward −z.
    dash.offset.y -= (animRef.current.speed * Math.min(dt, 0.1)) / DASH_TILE
  })

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial map={asphalt} color="#9aa0ad" roughness={0.94} metalness={0} />
      </mesh>
      {[-1.85, 1.85].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, -8]}>
          <planeGeometry args={[0.15, 240]} />
          <meshBasicMaterial map={dash} color="#cdd5e2" transparent toneMapped={false} />
        </mesh>
      ))}
      {[-5.6, 5.6].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, -8]}>
          <planeGeometry args={[0.12, 240]} />
          <meshBasicMaterial color="#3c4253" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Scenery: an infinite belt of biome segments (city → mountains →     */
/* desert) scrolling past on both sides at road speed. Distant         */
/* silhouettes only; fog provides the depth falloff, and city windows  */
/* glow when the day cycle reaches night.                              */
/* ------------------------------------------------------------------ */
const SEG_LEN = 60
const SEG_COUNT = 6
const BELT_LEN = SEG_LEN * SEG_COUNT
const BIOME_ORDER = ['city', 'mountain', 'desert', 'city', 'mountain', 'desert']

function buildSegmentItems(biome, segIndex) {
  const items = []
  for (const side of [1, -1]) {
    const base = segIndex * 97 + (side === 1 ? 0 : 49)
    if (biome === 'city') {
      const n = 6 + Math.floor(rnd(base) * 4)
      for (let j = 0; j < n; j++) {
        const s = base + j * 7
        const h = 7 + rnd(s + 1) * 24
        items.push({
          kind: 'building',
          pos: [side * (26 + rnd(s + 2) * 38), h / 2, (rnd(s + 3) - 0.5) * SEG_LEN],
          scale: [4 + rnd(s + 4) * 6, h, 4 + rnd(s + 5) * 6],
        })
      }
    } else if (biome === 'mountain') {
      const n = 3 + Math.floor(rnd(base) * 3)
      for (let j = 0; j < n; j++) {
        const s = base + j * 11
        const h = 16 + rnd(s + 1) * 26
        const r = 10 + rnd(s + 2) * 14
        items.push({
          kind: 'peak',
          pos: [side * (40 + rnd(s + 3) * 45), h / 2 - 0.5, (rnd(s + 4) - 0.5) * SEG_LEN],
          scale: [r, h, r],
          rot: [0, rnd(s + 5) * Math.PI, 0],
        })
      }
    } else {
      // desert: low dunes + a few saguaros
      const n = 3 + Math.floor(rnd(base) * 3)
      for (let j = 0; j < n; j++) {
        const s = base + j * 13
        items.push({
          kind: 'dune',
          pos: [side * (28 + rnd(s + 1) * 45), 0, (rnd(s + 2) - 0.5) * SEG_LEN],
          scale: [12 + rnd(s + 3) * 14, 2.2 + rnd(s + 4) * 2.4, 10 + rnd(s + 5) * 12],
        })
      }
      const c = 2 + Math.floor(rnd(base + 5) * 3)
      for (let j = 0; j < c; j++) {
        const s = base + 31 + j * 17
        const h = 2.6 + rnd(s + 1) * 2
        items.push({
          kind: 'cactus',
          pos: [side * (16 + rnd(s + 2) * 26), h / 2, (rnd(s + 3) - 0.5) * SEG_LEN],
          scale: [0.5, h, 0.5],
        })
      }
    }
  }
  return items
}

function Scenery({ animRef }) {
  const beltRef = useRef()
  const distRef = useRef(0)

  const geos = useMemo(
    () => ({
      building: new THREE.BoxGeometry(1, 1, 1),
      peak: new THREE.ConeGeometry(1, 1, 6),
      dune: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      cactus: new THREE.CylinderGeometry(1, 1, 1, 8),
    }),
    [],
  )
  // One shared material per kind — the building one animates its window
  // glow with the day cycle.
  const mats = useMemo(() => {
    const winTex = makeWindowsTexture()
    return {
      building: new THREE.MeshStandardMaterial({
        map: winTex,
        emissiveMap: winTex,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0.3,
        color: '#46505f',
        roughness: 0.9,
      }),
      peak: new THREE.MeshStandardMaterial({ color: '#1c2330', roughness: 1, flatShading: true }),
      dune: new THREE.MeshStandardMaterial({ color: '#3a2f1f', roughness: 1 }),
      cactus: new THREE.MeshStandardMaterial({ color: '#26402a', roughness: 0.95 }),
    }
  }, [])
  const segments = useMemo(
    () => BIOME_ORDER.map((biome, i) => buildSegmentItems(biome, i)),
    [],
  )

  useFrame((_, dt) => {
    distRef.current += animRef.current.speed * Math.min(dt, 0.1)
    const d = distRef.current
    const belt = beltRef.current
    if (belt) {
      for (let i = 0; i < belt.children.length; i++) {
        belt.children[i].position.z = 60 - ((i * SEG_LEN + d) % BELT_LEN)
      }
    }
    mats.building.emissiveIntensity = 0.25 + 1.6 * (animRef.current.night ?? 0)
  })

  return (
    <group ref={beltRef}>
      {segments.map((items, i) => (
        <group key={i}>
          {items.map((it, j) => (
            <mesh
              key={j}
              geometry={geos[it.kind]}
              material={mats[it.kind]}
              position={it.pos}
              scale={it.scale}
              rotation={it.rot || [0, 0, 0]}
            />
          ))}
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Shared spinning axle: tire cylinders + hub caps + axle rod, rotated */
/* at road speed / wheel radius. unitScale converts local units to     */
/* meters (the trailer GLB group is scaled 0.315).                     */
/* ------------------------------------------------------------------ */
function SpinAxle({ z, y, radius, sideX, width, hubRadius, rodRadius, unitScale, animRef }) {
  const ref = useRef()

  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.x += (animRef.current.speed / (radius * unitScale)) * Math.min(dt, 0.1)
    }
  })

  return (
    <group ref={ref} position={[0, y, z]}>
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[side * sideX, 0, 0]} castShadow>
            <cylinderGeometry args={[radius, radius, width, 24]} />
            <meshStandardMaterial color="#141519" roughness={0.92} />
          </mesh>
          <mesh
            rotation={[0, (side * Math.PI) / 2, 0]}
            position={[side * (sideX + width / 2 + 0.02 / unitScale), 0, 0]}
          >
            <circleGeometry args={[hubRadius, 20]} />
            <meshStandardMaterial color="#454a55" roughness={0.45} metalness={0.6} />
          </mesh>
        </group>
      ))}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[rodRadius, rodRadius, sideX * 2, 10]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.8} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Tractor: white cab, tinted glass, MANAS door decals, spinning       */
/* wheels. Wheel meshes live under the GLB group "ruedas de camion_42" */
/* with pivots baked at the model origin, so we recenter each wheel    */
/* geometry on its own hub once (idempotent).                          */
/* ------------------------------------------------------------------ */
function Tractor({ animRef }) {
  const { scene } = useGLTF(TRACTOR_URL)
  const spinRef = useRef([])
  const logo = useTexture(MANAS_LOGO_URL)
  const logoAspect = logo.image ? logo.image.width / logo.image.height : 1
  const accentStripe = useMemo(() => makeAccentStripeTexture(), [])
  const [cabMesh, setCabMesh] = useState(null)

  useEffect(() => {
    logo.colorSpace = THREE.SRGBColorSpace
  }, [logo])

  useEffect(() => {
    const spin = []
    let wheelsGroup = null
    let cab = null
    let cabSize = 0
    // Limo tint for glass panes whose materials are shared with non-glass
    // parts (the "vidrio" meshes reuse chassis materials) — assign per mesh.
    const tintMat = new THREE.MeshStandardMaterial({
      color: '#04060a',
      roughness: 0.45,
      metalness: 0.3,
      envMapIntensity: 0.25, // keep tint dark even under bright env
      side: THREE.DoubleSide, // glass normals face inward in places
    })
    scene.traverse((o) => {
      if (/^ruedas/i.test(o.name)) wheelsGroup = o
      if (!o.isMesh) return
      o.castShadow = true
      if (/vidrio/i.test(o.name) || /vidrio/i.test(o.parent?.name ?? '')) {
        o.material = tintMat
        return
      }
      const mat = o.material
      if (!mat) return
      // Cab body (material "AZUL" — ships red): repaint white so the
      // MANAS mark reads. Drop the base map in case it carries the paint.
      if (/azul/i.test(mat.name)) {
        mat.color.set('#e9edf2')
        mat.map = null
        mat.roughness = 0.32
        mat.metalness = 0.12
        mat.needsUpdate = true
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        const s = o.geometry.boundingBox.getSize(new THREE.Vector3())
        if (s.x * s.y * s.z > cabSize) {
          cabSize = s.x * s.y * s.z
          cab = o
        }
      }
      // Glass ("glass1") and windshield ("DARK"): limo tint — the GLB cab
      // has no interior, so nothing to see.
      // Yellow dash/catwalk accents show through the open windshield
      // aperture in front of the blocker — mute them to dark hardware gray.
      if (/^color_yellow/i.test(mat.name)) {
        mat.color.set('#23262d')
        mat.needsUpdate = true
      }
      if (/^(glass|dark$)/i.test(mat.name)) {
        if ('transmission' in mat) mat.transmission = 0
        mat.transparent = false
        mat.opacity = 1
        mat.color.set('#04060a')
        mat.roughness = 0.45
        mat.metalness = 0.3
        mat.envMapIntensity = 0.25
        mat.side = THREE.DoubleSide
        mat.needsUpdate = true
      }
    })
    wheelsGroup?.traverse((o) => {
      if (!o.isMesh) return
      const geo = o.geometry
      if (!geo.userData.wheelCenter) {
        geo.computeBoundingBox()
        const size = geo.boundingBox.getSize(new THREE.Vector3())
        // wheel-shaped: round in YZ, thin along the X axle
        const round = Math.abs(size.y - size.z) < 0.2 * Math.max(size.y, size.z)
        if (!round || size.x > Math.max(size.y, size.z) * 1.2) return
        const center = geo.boundingBox.getCenter(new THREE.Vector3())
        geo.translate(-center.x, -center.y, -center.z)
        geo.userData.wheelCenter = center
      }
      o.position.copy(geo.userData.wheelCenter)
      spin.push(o)
    })
    spinRef.current = spin
    setCabMesh(cab)
  }, [scene])

  useFrame((_, dt) => {
    // ω = v/r, positive about +x = rolling toward +z (forward).
    const w = (animRef.current.speed / WHEEL_RADIUS) * Math.min(dt, 0.1)
    for (const wheel of spinRef.current) wheel.rotation.x += w
  })

  return (
    <group>
      <primitive object={scene} />
      {/* The GLB ships with an OPEN windshield aperture (its "parabrisa"
          mesh is just the wiper trim). A fitted exterior pane always shows
          an edge (rectangle vs. trapezoid aperture), so instead: a matte
          near-black blocker RECESSED inside the cab — oversized on
          purpose, its edges hide behind the body shell, and the aperture
          reads as deep tint from every angle. */}
      <mesh position={[0, 2.38, -1.18]} rotation={[-0.39, 0, 0]}>
        <planeGeometry args={[2.0, 1.0]} />
        <meshStandardMaterial color="#05070a" roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* MANAS marks: as large as the white sleeper panel allows (the
          black rear pillar is a separate dark-plastic mesh decals can't
          print on), the hood top, and a design-1-style red accent swoosh
          along each upper sleeper line. */}
      {cabMesh &&
        [
          { key: 'left', position: [1.5, 2.3, -2.83], rotation: [0, Math.PI / 2, 0], scale: [1.2, 1.2 / logoAspect, 1.2] },
          { key: 'right', position: [-1.5, 2.3, -2.83], rotation: [0, -Math.PI / 2, 0], scale: [1.2, 1.2 / logoAspect, 1.2] },
          { key: 'hood', position: [0, 1.9, 0.12], rotation: [-Math.PI / 2, 0, 0], scale: [0.85, 0.85 / logoAspect, 1.2] },
          { key: 'stripe-l', position: [1.45, 3.32, -2.9], rotation: [0, Math.PI / 2, 0], scale: [2.6, 0.34, 1.2], map: 'stripe' },
          { key: 'stripe-r', position: [-1.45, 3.32, -2.9], rotation: [0, -Math.PI / 2, 0], scale: [2.6, 0.34, 1.2], map: 'stripe' },
        ].map((d) => (
          <Decal
            key={d.key}
            mesh={{ current: cabMesh }}
            position={d.position}
            rotation={d.rotation}
            scale={d.scale}
          >
            <meshStandardMaterial
              map={d.map === 'stripe' ? accentStripe : logo}
              transparent
              polygonOffset
              polygonOffsetFactor={-10}
              depthWrite={false}
              roughness={0.5}
            />
          </Decal>
        ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Trailer variants                                                    */
/* ------------------------------------------------------------------ */

// Side branding as wall-hugging planes (trailer-local units, 1 ≈ 0.315 m).
// drei <Decal> projects in world space, which misplaces inside this scaled
// group — and the van walls are flat, so planes are visually identical.
function SideBranding({ map, aspect, y, width, z = -20, opaque = false }) {
  return [1, -1].map((side) => (
    <mesh key={side} position={[side * 3.58, y, z]} rotation={[0, (side * Math.PI) / 2, 0]}>
      <planeGeometry args={[width, width / aspect]} />
      <meshStandardMaterial
        map={map}
        transparent={!opaque}
        polygonOffset
        polygonOffsetFactor={-10}
        depthWrite={opaque}
        roughness={0.5}
      />
    </mesh>
  ))
}

function VanTrailer({ variant, animRef }) {
  const { scene } = useGLTF(TRAILER_URL)
  const logo = useTexture(MANAS_LOGO_URL)
  const logoAspect = logo.image ? logo.image.width / logo.image.height : 1

  const model = useMemo(() => {
    const model = scene.clone(true)
    let bodyMat = null
    model.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      // The GLB's rear bogie is one merged mesh (both axles, both sides) —
      // it can't spin. Hide its tires/hubs; SpinAxle replaces them. The
      // suspension frame ("Black_material") stays.
      if (o.material && /^(tire|wheel)/i.test(o.material.name)) {
        o.visible = false
        return
      }
      if (variant !== 'dryvan' && o.material && /trailer_white/i.test(o.material.name)) {
        if (!bodyMat) {
          bodyMat = o.material.clone()
          if (variant === 'reefer') {
            bodyMat.color.set('#eef2f4')
            bodyMat.roughness = 0.35
          } else if (variant === 'customer') {
            bodyMat.color.set('#0f81dd') // deep #1399FF-family blue
            bodyMat.roughness = 0.45
          }
        }
        o.material = bodyMat
      }
    })
    return model
  }, [scene, variant])

  const wordmark = useMemo(
    () => (variant === 'customer' ? makeCustomerWordmarkTexture(MOCK_TOP_CUSTOMER.replace(/ Inc$/i, '')) : null),
    [variant],
  )
  // Dry van wears the full MANAS stripe wrap (red/black sweeps + badge);
  // the reefer stays clean white with just the mark.
  const wrap = useMemo(() => (variant === 'dryvan' ? makeTrailerWrapTexture() : null), [variant])

  return (
    <group scale={TRAILER_SCALE}>
      <primitive object={model} />
      {/* replacement bogie at the GLB's axle stations (local units) */}
      {[-35.4, -38.85].map((z) => (
        <SpinAxle
          key={z}
          z={z}
          y={1.8}
          radius={1.62}
          sideX={2.28}
          width={1.55}
          hubRadius={0.85}
          rodRadius={0.26}
          unitScale={TRAILER_SCALE}
          animRef={animRef}
        />
      ))}
      {variant === 'dryvan' && wrap && (
        <SideBranding map={wrap} aspect={4.21} y={8.1} width={40} z={-22.5} opaque />
      )}
      {variant === 'reefer' && <SideBranding map={logo} aspect={logoAspect} y={8.9} width={7.5} />}
      {variant === 'customer' && wordmark && (
        <SideBranding map={wordmark} aspect={1024 / 192} y={7.6} width={24} />
      )}
      {variant === 'reefer' && <ReeferUnit />}
    </group>
  )
}

// Procedural refrigeration unit on the trailer's front face (local units).
function ReeferUnit() {
  return (
    <group position={[0, 5.2, -1.85]}>
      <mesh castShadow>
        <boxGeometry args={[5.2, 6, 1.3]} />
        <meshStandardMaterial color="#2b2e35" roughness={0.55} metalness={0.35} />
      </mesh>
      {[1.2, 0.3, -0.6, -1.5].map((y) => (
        <mesh key={y} position={[0, y, 0.68]}>
          <boxGeometry args={[4.4, 0.28, 0.06]} />
          <meshStandardMaterial color="#15171c" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, -2.4, 0.4]} castShadow>
        <boxGeometry args={[3.2, 1.1, 1.9]} />
        <meshStandardMaterial color="#1d1f25" roughness={0.6} metalness={0.3} />
      </mesh>
    </group>
  )
}

// Procedural flatbed, built in real-world meters. Front face sits at the
// same world z as the van variants' front face.
function Flatbed({ animRef }) {
  const planks = useMemo(() => makePlankTexture(), [])
  const tape = useMemo(() => makeReflectiveTapeTexture(), [])

  return (
    <group position={[0, 0, -0.77]}>
      {/* deck */}
      <mesh position={[0, 1.38, -6.5]} castShadow>
        <boxGeometry args={[2.6, 0.26, 13]} />
        <meshStandardMaterial color="#23262d" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.515, -6.5]}>
        <planeGeometry args={[2.52, 12.9]} />
        <meshStandardMaterial map={planks} roughness={0.85} />
      </mesh>
      {/* side rails with reflective tape */}
      {[1, -1].map((side) => (
        <mesh key={side} rotation={[0, (side * Math.PI) / 2, 0]} position={[side * 1.305, 1.38, -6.5]}>
          <planeGeometry args={[12.9, 0.18]} />
          <meshStandardMaterial map={tape} roughness={0.4} />
        </mesh>
      ))}
      {/* frame rails + kingpin riser */}
      {[0.55, -0.55].map((x) => (
        <mesh key={x} position={[x, 1.05, -6.8]} castShadow>
          <boxGeometry args={[0.14, 0.34, 11.6]} />
          <meshStandardMaterial color="#15161b" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 1.15, -0.9]}>
        <boxGeometry args={[1.1, 0.28, 1.7]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.8} />
      </mesh>
      {/* rear axle group */}
      {[-10.3, -11.7].map((z) => (
        <SpinAxle
          key={z}
          z={z}
          y={0.5}
          radius={0.5}
          sideX={0.82}
          width={0.95}
          hubRadius={0.26}
          rodRadius={0.09}
          unitScale={1}
          animRef={animRef}
        />
      ))}
    </group>
  )
}

// Swap wrapper: shrink the outgoing trailer, then mount and grow the new
// one (~200 ms each way). All variants share the hitch position.
function Trailer({ type, animRef }) {
  const [shown, setShown] = useState(type)
  const pivotRef = useRef()

  useFrame((_, dt) => {
    const g = pivotRef.current
    if (!g) return
    const target = shown === type ? 1 : 0.001
    const next = THREE.MathUtils.damp(g.scale.x, target, 16, Math.min(dt, 0.1))
    g.scale.setScalar(next)
    if (shown !== type && next < 0.05) setShown(type)
  })

  return (
    <group position={[0, 0, TRAILER_GROUP_Z]}>
      {/* pivot at trailer mid so the swap scales around its center */}
      <group position={[0, 1.9, -7.2]}>
        <group ref={pivotRef}>
          <group position={[0, -1.9, 7.2]}>
            {shown === 'flatbed' ? <Flatbed animRef={animRef} /> : <VanTrailer variant={shown} animRef={animRef} />}
          </group>
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Rig: tractor + trailer with suspension bob / tilt / shudder         */
/* ------------------------------------------------------------------ */
function Rig({ animRef, trailerType }) {
  const groupRef = useRef()

  useFrame(({ clock }) => {
    const g = groupRef.current
    if (!g) return
    const a = animRef.current
    const t = clock.elapsedTime
    const bob = Math.sin(t * a.bobFreq * Math.PI * 2) * a.bobAmp
    // occasional shudder burst (headwind only)
    const window_ = Math.max(0, Math.sin(t * 0.6) - 0.9) * 10
    const shudder = a.shudder * window_ * Math.sin(t * 41) * 0.004
    g.position.y = bob + shudder * 0.4
    g.rotation.x = a.tilt + bob * 0.12
    g.rotation.z = shudder
  })

  return (
    <group ref={groupRef}>
      <Tractor animRef={animRef} />
      <Trailer type={trailerType} animRef={animRef} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Controls: damped orbit, framed distances, never under the road.     */
/* Auto-rotates slowly after 8 s idle.                                 */
/* ------------------------------------------------------------------ */
function RigControls() {
  const controlsRef = useRef()
  const nowRef = useRef(0)
  const lastInteractRef = useRef(-20)

  useFrame(({ clock }) => {
    nowRef.current = clock.elapsedTime
    const c = controlsRef.current
    if (c) c.autoRotate = nowRef.current - lastInteractRef.current > 8
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 1.8, -8.5]}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={8}
      maxDistance={30}
      minPolarAngle={0.3}
      maxPolarAngle={1.45}
      autoRotateSpeed={0.3}
      onStart={() => {
        lastInteractRef.current = Infinity
      }}
      onEnd={() => {
        lastInteractRef.current = nowRef.current
      }}
    />
  )
}

function SceneLoader() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3" style={{ pointerEvents: 'none' }}>
        <div className="h-3 w-3 rounded-full bg-[#e9c984] animate-ping" />
        <div className="text-[11px] tracking-[0.35em] text-[#e9c984]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          LOADING RIG
        </div>
      </div>
    </Html>
  )
}

/* ------------------------------------------------------------------ */
export default function RigScene({ rigState, trailerType }) {
  const animRef = useRef({
    speed: RIG_STATES[rigState].laneSpeed,
    bobAmp: 0.02,
    bobFreq: 1.3,
    tilt: 0,
    shudder: 0,
    night: 0,
  })

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [15.5, 5, 9], fov: 40 }}
      gl={{ antialias: true }}
    >
      <Atmosphere rigState={rigState} animRef={animRef} />
      <Suspense fallback={<SceneLoader />}>
        <Road animRef={animRef} />
        <Scenery animRef={animRef} />
        <Rig animRef={animRef} trailerType={trailerType} />
        <ContactShadows position={[0, 0.005, -7]} scale={34} far={4} blur={2.2} opacity={0.55} resolution={512} frames={Infinity} />
      </Suspense>
      <RigControls />
    </Canvas>
  )
}
