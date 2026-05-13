'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type BowlCfg = {
  name: string
  note: string
  freq: number
  hue: number
  desc: string
}

const BOWLS: BowlCfg[] = [
  { name: 'Root',      note: 'C', freq: 130.81, hue: 14,  desc: 'Earth · Grounding' },
  { name: 'Sacral',    note: 'D', freq: 146.83, hue: 28,  desc: 'Water · Flow' },
  { name: 'Solar',     note: 'E', freq: 164.81, hue: 45,  desc: 'Fire · Will' },
  { name: 'Heart',     note: 'F', freq: 174.61, hue: 145, desc: 'Air · Love' },
  { name: 'Throat',    note: 'G', freq: 196.00, hue: 195, desc: 'Sound · Truth' },
  { name: 'Third Eye', note: 'A', freq: 220.00, hue: 250, desc: 'Light · Insight' },
  { name: 'Crown',     note: 'B', freq: 246.94, hue: 285, desc: 'Thought · Unity' },
]

class BowlVoice {
  ctx: AudioContext
  master: GainNode
  partials: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode }[] = []
  vibrato: OscillatorNode
  vibratoGain: GainNode
  alive = true

  constructor(ctx: AudioContext, fundamental: number, outputs: AudioNode[]) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    outputs.forEach(o => this.master.connect(o))

    this.vibrato = ctx.createOscillator()
    this.vibrato.frequency.value = 5.2
    this.vibratoGain = ctx.createGain()
    this.vibratoGain.gain.value = 1.4
    this.vibrato.connect(this.vibratoGain)
    this.vibrato.start()

    const ratios = [1.0, 2.76, 5.40, 8.93, 13.34]
    const amps   = [1.0, 0.55, 0.28, 0.14, 0.07]
    const beats  = [0.4, 1.2, 2.0, 2.8, 3.6]

    ratios.forEach((r, i) => {
      const f = fundamental * r
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f + beats[i]
      const g = ctx.createGain(); g.gain.value = amps[i]
      this.vibratoGain.connect(o1.frequency)
      this.vibratoGain.connect(o2.frequency)
      o1.connect(g); o2.connect(g)
      g.connect(this.master)
      o1.start(); o2.start()
      this.partials.push({ o1, o2, g })
    })
  }

  setLevel(level: number, ramp = 0.12) {
    if (!this.alive) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(Math.max(0.0001, level), now + ramp)
  }

  strike(power = 0.7) {
    if (!this.alive) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    const cur = Math.max(this.master.gain.value, 0.0001)
    this.master.gain.setValueAtTime(Math.min(cur + power, 1.2), now)
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 9)
  }

  currentLevel() {
    return this.master.gain.value
  }

  stop() {
    if (!this.alive) return
    this.alive = false
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.linearRampToValueAtTime(0, now + 0.4)
    setTimeout(() => {
      this.partials.forEach(p => { try { p.o1.stop(); p.o2.stop() } catch {} })
      try { this.vibrato.stop() } catch {}
    }, 500)
  }
}

class BowlEngine {
  ctx: AudioContext
  master: GainNode
  dry: GainNode
  reverb: ConvolverNode
  reverbGain: GainNode
  voice: BowlVoice | null = null

  constructor() {
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.75
    this.dry = this.ctx.createGain()
    this.dry.gain.value = 0.55
    this.reverbGain = this.ctx.createGain()
    this.reverbGain.gain.value = 0.45
    this.reverb = this.ctx.createConvolver()
    this.reverb.buffer = this.makeImpulse(5, 2.6)
    this.dry.connect(this.master)
    this.reverb.connect(this.reverbGain).connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  private makeImpulse(seconds: number, decay: number) {
    const sr = this.ctx.sampleRate
    const len = Math.floor(sr * seconds)
    const buf = this.ctx.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c)
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
      }
    }
    return buf
  }

  loadBowl(freq: number) {
    if (this.voice) this.voice.stop()
    this.voice = new BowlVoice(this.ctx, freq, [this.dry, this.reverb])
  }

  setReverb(amount: number) {
    const now = this.ctx.currentTime
    this.reverbGain.gain.cancelScheduledValues(now)
    this.reverbGain.gain.linearRampToValueAtTime(amount, now + 0.2)
  }

  setVolume(v: number) {
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.linearRampToValueAtTime(v, now + 0.1)
  }

  resume() { return this.ctx.resume() }
}

type Ripple = { x: number; y: number; r: number; alpha: number; hue: number }
type MotionStatus = 'idle' | 'granted' | 'denied' | 'unavailable'

export default function MotionBowl() {
  const [bowlIdx, setBowlIdx] = useState(5)
  const [reverb, setReverb] = useState(0.45)
  const [volume, setVolume] = useState(0.75)
  const [started, setStarted] = useState(false)
  const [motion, setMotion] = useState<MotionStatus>('idle')
  const [intensityDisplay, setIntensityDisplay] = useState(0)
  const [hint, setHint] = useState(true)

  const engineRef = useRef<BowlEngine | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  const bowl = BOWLS[bowlIdx]
  const hue = bowl.hue

  const stateRef = useRef({
    cx: 0, cy: 0, radius: 0,
    lastAlpha: null as number | null,
    lastT: 0,
    speed: 0,                 // smoothed degrees/sec
    alphaDeg: 0,              // most recent alpha in degrees (compass)
    targetIntensity: 0,
    intensity: 0,
    glowPulse: 0,
    ripples: [] as Ripple[],
    sparks: Array.from({ length: 56 }, (_, i) => ({
      angle: (i / 56) * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      r: 0,
    })),
    hue,
    motionLive: false,        // becomes true once at least one orientation event has been received
  })

  useEffect(() => { stateRef.current.hue = hue }, [hue])

  const needsExplicitPermission = useMemo(() => {
    if (typeof window === 'undefined') return false
    const D: any = (window as any).DeviceOrientationEvent
    return D && typeof D.requestPermission === 'function'
  }, [])

  // iOS gates DeviceOrientationEvent.requestPermission() on a live user
  // gesture. Awaiting *anything* before the call drops us out of that
  // gesture window and iOS silently resolves the promise to "denied"
  // without even showing the prompt — so we must kick the promise off
  // synchronously, BEFORE any await.
  const kickMotionRequest = useCallback((): Promise<MotionStatus> => {
    if (typeof window === 'undefined') return Promise.resolve('unavailable')
    const D: any = (window as any).DeviceOrientationEvent
    if (!D) return Promise.resolve('unavailable')
    if (typeof D.requestPermission !== 'function') return Promise.resolve('granted')
    try {
      return D.requestPermission()
        .then((r: string) => (r === 'granted' ? 'granted' : 'denied') as MotionStatus)
        .catch(() => 'denied' as MotionStatus)
    } catch {
      return Promise.resolve('denied')
    }
  }, [])

  const retryMotion = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault()
    // Synchronous kick from the user gesture.
    const p = kickMotionRequest()
    p.then(setMotion)
  }, [kickMotionRequest])

  const ensureStarted = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new BowlEngine()
    // Kick BOTH off synchronously to preserve the user gesture for iOS.
    const resumePromise = engineRef.current.resume()
    const motionPromise = kickMotionRequest()
    await resumePromise
    if (!engineRef.current.voice) engineRef.current.loadBowl(bowl.freq)
    setStarted(true)
    setMotion(await motionPromise)
  }, [bowl.freq, kickMotionRequest])

  useEffect(() => {
    if (!started) return
    const id = setTimeout(() => setHint(false), 6000)
    return () => clearTimeout(id)
  }, [started])

  useEffect(() => {
    if (engineRef.current && started) engineRef.current.loadBowl(bowl.freq)
  }, [bowl.freq, started])

  useEffect(() => { engineRef.current?.setReverb(reverb) }, [reverb])
  useEffect(() => { engineRef.current?.setVolume(volume) }, [volume])

  // Resize + DPR-aware canvas
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const w = cvs.clientWidth
      const h = cvs.clientHeight
      cvs.width = Math.floor(w * dpr)
      cvs.height = Math.floor(h * dpr)
      const ctx = cvs.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const s = stateRef.current
      s.cx = w / 2
      s.cy = h / 2
      const vMin = Math.min(window.innerWidth, window.innerHeight)
      const cMin = Math.min(w, h)
      const compact = vMin < 760
      const desired = compact ? vMin * 0.42 : cMin * 0.36
      s.radius = Math.min(desired, cMin * 0.48)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Tap anywhere to strike the bowl. No rim tracing in motion mode.
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const onDown = async (e: PointerEvent) => {
      const rect = cvs.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const s = stateRef.current
      const dist = Math.hypot(x - s.cx, y - s.cy)
      if (dist > s.radius * 1.1) return
      if (!started) {
        await ensureStarted()
      }
      engineRef.current?.voice?.strike(0.6)
      s.glowPulse = 1
      s.ripples.push({ x: s.cx, y: s.cy, r: 12, alpha: 1, hue: s.hue })
    }
    cvs.addEventListener('pointerdown', onDown)
    return () => cvs.removeEventListener('pointerdown', onDown)
  }, [ensureStarted, started])

  // Device orientation -> rotation-rate-driven intensity
  useEffect(() => {
    if (!started || motion !== 'granted') return
    if (typeof window === 'undefined') return

    const onOrient = (e: DeviceOrientationEvent) => {
      const a = e.alpha
      if (a == null) return
      const s = stateRef.current
      const now = performance.now()
      s.alphaDeg = a
      s.motionLive = true
      if (s.lastAlpha == null) {
        s.lastAlpha = a
        s.lastT = now
        return
      }
      const dt = Math.max(1, now - s.lastT) / 1000
      let da = a - s.lastAlpha
      if (da > 180) da -= 360
      if (da < -180) da += 360
      const angVel = Math.abs(da) / dt
      s.speed = s.speed * 0.7 + angVel * 0.3
      // 20 deg/s -> silent, ~260 deg/s -> max
      s.targetIntensity = Math.min(1, Math.max(0, (s.speed - 20) / 240))
      s.lastAlpha = a
      s.lastT = now
      if (Math.random() < 0.18 + s.targetIntensity * 0.45) {
        const ang = (a - 90) * Math.PI / 180
        const x = s.cx + Math.cos(ang) * s.radius
        const y = s.cy + Math.sin(ang) * s.radius
        s.ripples.push({ x, y, r: 4, alpha: 0.7, hue: s.hue })
        if (s.ripples.length > 60) s.ripples.shift()
      }
    }

    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [started, motion])

  // Animation + audio level loop
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')!
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000
      last = now
      const s = stateRef.current

      // Decay rotation speed if no recent updates (motion stops -> intensity falls)
      if (now - s.lastT > 120) {
        s.speed *= Math.pow(0.001, dt)
        s.targetIntensity = Math.min(s.targetIntensity, s.speed / 240)
      }

      const decay = 0.5
      s.intensity += (s.targetIntensity - s.intensity) * Math.min(1, decay * (dt * 60) / 8)
      s.glowPulse *= Math.pow(0.001, dt)

      const v = engineRef.current?.voice
      if (v) {
        const base = v.currentLevel()
        const target = Math.max(base * 0.92 ** (dt * 12), s.intensity * 0.85)
        if (s.intensity > 0.02) v.setLevel(s.intensity * 0.85, 0.15)
        else if (target < base) v.setLevel(target, 0.4)
      }

      setIntensityDisplay(s.intensity)

      // ---- Render ----
      const w = cvs.clientWidth, h = cvs.clientHeight
      ctx.clearRect(0, 0, w, h)

      const bgGrad = ctx.createRadialGradient(s.cx, s.cy, s.radius * 0.2, s.cx, s.cy, s.radius * 3)
      const ambient = 0.18 + s.intensity * 0.18 + s.glowPulse * 0.12
      bgGrad.addColorStop(0, `hsla(${s.hue}, 60%, 35%, ${ambient})`)
      bgGrad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      const glowR = s.radius * (1.05 + s.intensity * 0.06 + s.glowPulse * 0.08)
      const glow = ctx.createRadialGradient(s.cx, s.cy, s.radius * 0.7, s.cx, s.cy, glowR * 1.7)
      glow.addColorStop(0, `hsla(${s.hue}, 80%, 60%, 0)`)
      glow.addColorStop(0.45, `hsla(${s.hue}, 80%, 60%, ${0.18 + s.intensity * 0.35})`)
      glow.addColorStop(1, `hsla(${s.hue}, 80%, 60%, 0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, glowR * 1.7, 0, Math.PI * 2)
      ctx.fill()

      const bodyGrad = ctx.createRadialGradient(
        s.cx - s.radius * 0.35, s.cy - s.radius * 0.45, s.radius * 0.1,
        s.cx, s.cy, s.radius
      )
      bodyGrad.addColorStop(0, `hsla(${s.hue}, 30%, 78%, 1)`)
      bodyGrad.addColorStop(0.35, `hsla(${s.hue}, 35%, 50%, 1)`)
      bodyGrad.addColorStop(0.75, `hsla(${s.hue}, 50%, 22%, 1)`)
      bodyGrad.addColorStop(1, `hsla(${s.hue}, 60%, 12%, 1)`)
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.radius, 0, Math.PI * 2)
      ctx.fillStyle = bodyGrad
      ctx.fill()

      const wellR = s.radius * 0.78
      const well = ctx.createRadialGradient(s.cx, s.cy - s.radius * 0.05, wellR * 0.05, s.cx, s.cy, wellR)
      well.addColorStop(0, `hsla(${s.hue}, 60%, 8%, 1)`)
      well.addColorStop(0.7, `hsla(${s.hue}, 50%, 14%, 1)`)
      well.addColorStop(1, `hsla(${s.hue}, 40%, 28%, 0)`)
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, wellR, 0, Math.PI * 2)
      ctx.fillStyle = well
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, wellR, 0, Math.PI * 2)
      ctx.clip()
      for (let i = 0; i < 6; i++) {
        const phase = (now / 1400 + i / 6) % 1
        const rr = phase * wellR
        const a = (1 - phase) * (0.05 + s.intensity * 0.35)
        ctx.beginPath()
        ctx.arc(s.cx, s.cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${s.hue}, 70%, 70%, ${a})`
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      ctx.restore()

      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.radius * 0.99, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${s.hue}, 50%, 80%, 0.55)`
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.radius * 0.78, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 2
      ctx.stroke()

      const sparkR = s.radius * 0.88
      s.sparks.forEach((sp, i) => {
        sp.angle += dt * (0.05 + s.intensity * 0.6)
        sp.phase += dt * (1.5 + i * 0.05)
        const px = s.cx + Math.cos(sp.angle) * sparkR
        const py = s.cy + Math.sin(sp.angle) * sparkR
        const a = 0.15 + (Math.sin(sp.phase) * 0.5 + 0.5) * (0.25 + s.intensity * 0.7)
        const sz = 1.2 + (Math.sin(sp.phase) * 0.5 + 0.5) * (1.4 + s.intensity * 2.2)
        ctx.beginPath()
        ctx.arc(px, py, sz, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${s.hue}, 80%, 80%, ${a})`
        ctx.fill()
      })

      // Mallet indicator: dot on the rim at the compass-heading angle.
      // Drawn only once we've actually received an orientation sample.
      if (s.motionLive) {
        const malletAng = (s.alphaDeg - 90) * Math.PI / 180
        const mx = s.cx + Math.cos(malletAng) * sparkR
        const my = s.cy + Math.sin(malletAng) * sparkR
        const mr = 10 + s.intensity * 12
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, mr)
        grad.addColorStop(0, `hsla(${s.hue}, 95%, 92%, ${0.85 + s.intensity * 0.15})`)
        grad.addColorStop(1, `hsla(${s.hue}, 95%, 70%, 0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(mx, my, mr, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(mx, my, 2.4, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${s.hue}, 95%, 96%, ${0.9})`
        ctx.fill()
      }

      // Ripples
      for (let i = s.ripples.length - 1; i >= 0; i--) {
        const r = s.ripples[i]
        r.r += dt * 90
        r.alpha *= Math.pow(0.45, dt)
        if (r.alpha < 0.02) { s.ripples.splice(i, 1); continue }
        ctx.beginPath()
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${r.hue}, 90%, 75%, ${r.alpha})`
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { engineRef.current?.voice?.stop() }, [])

  // Keyboard: 1..7 picks a bowl, space strikes
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '7') {
        setBowlIdx(parseInt(e.key, 10) - 1)
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (!started) await ensureStarted()
        engineRef.current?.voice?.strike(0.6)
        stateRef.current.glowPulse = 1
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ensureStarted, started])

  const cssHue = useMemo(() => `hsl(${hue} 70% 65%)`, [hue])

  const overlayCopy = (() => {
    if (!started) {
      return needsExplicitPermission
        ? 'Tap to wake the bowl and allow motion access.'
        : 'Tap to wake the bowl.'
    }
    return null
  })()

  const statusLine = (() => {
    if (!started) return null
    if (motion === 'granted') return null
    if (motion === 'unavailable') return 'No motion sensor — tap the bowl to strike.'
    return null
  })()

  return (
    <main className="bowl-main" style={styles.main}>
      <header className="bowl-header" style={styles.header}>
        <div className="bowl-titleBlock" style={styles.titleBlock}>
          <div style={styles.titleRow}>
            <BowlMark hue={hue} />
            <div className="bowl-title" style={{ ...styles.title, color: cssHue }}>Singing Bowl · Motion</div>
          </div>
          <div className="bowl-subtitle" style={styles.subtitle}>
            {bowl.name} · {bowl.note} · {bowl.desc}
          </div>
        </div>
        <div className="bowl-headerControls" style={styles.headerControls}>
          <a href="/" style={styles.backLink} aria-label="Back to finger-controlled bowl">↺ Finger</a>
          <Knob label="Reverb" value={reverb} onChange={setReverb} hue={hue} />
          <Knob label="Volume" value={volume} onChange={setVolume} hue={hue} />
        </div>
      </header>

      <div className="bowl-stage" style={styles.stage}>
        <canvas ref={canvasRef} className="bowl-canvas" style={styles.canvas} />
        {!started && (
          <div style={styles.overlay} onPointerDown={ensureStarted}>
            <div style={styles.overlayInner}>
              <div style={{ ...styles.overlayTitle, color: cssHue }}>Begin</div>
              <div style={styles.overlayText}>{overlayCopy}</div>
            </div>
          </div>
        )}
        {started && hint && motion === 'granted' && (
          <div className="bowl-hint" style={styles.hint}>
            Rotate the phone smoothly. Tap the bowl to strike.
          </div>
        )}
        {statusLine && (
          <div className="bowl-hint" style={styles.hint}>{statusLine}</div>
        )}
        {started && motion === 'denied' && needsExplicitPermission && (
          <button
            type="button"
            className="bowl-motion-retry"
            onPointerDown={retryMotion}
            style={styles.retryBtn}
          >
            Tap to allow motion access
          </button>
        )}
        <div style={styles.meter} aria-hidden>
          <div
            style={{
              ...styles.meterFill,
              width: `${Math.round(intensityDisplay * 100)}%`,
              background: `linear-gradient(90deg, hsla(${hue},80%,60%,0.25), hsl(${hue} 80% 70%))`,
            }}
          />
        </div>
      </div>

      <footer className="bowl-footer" style={styles.footer}>
        {BOWLS.map((b, i) => {
          const active = i === bowlIdx
          return (
            <button
              key={b.note}
              className={`bowl-chip${active ? ' is-active' : ''}`}
              onClick={async () => { setBowlIdx(i); if (!started) await ensureStarted() }}
              style={{
                ...styles.bowlChip,
                borderColor: active ? `hsl(${b.hue} 70% 60%)` : 'transparent',
                boxShadow: active
                  ? `0 0 24px hsla(${b.hue}, 80%, 55%, 0.55), inset 0 0 12px hsla(${b.hue}, 80%, 55%, 0.3)`
                  : '0 1px 0 rgba(255,255,255,0.04) inset',
                background: `radial-gradient(circle at 30% 25%, hsl(${b.hue} 50% 55%), hsl(${b.hue} 60% 18%))`,
              }}
              title={`${b.name} · ${b.note} · ${b.desc}`}
            >
              <span className="bowl-chip-note" style={styles.chipNote}>{b.note}</span>
              <span className="bowl-chip-name" style={styles.chipName}>{b.name}</span>
            </button>
          )
        })}
      </footer>

      <div className="bowl-hotkeys" style={styles.hotkeys}>1–7 selects a bowl · Space strikes</div>

      <style jsx global>{`
        /* Same column-overflow guard as /. */
        .bowl-main { grid-template-columns: minmax(0, 1fr); }
        .bowl-header,
        .bowl-stage,
        .bowl-footer,
        .bowl-headerControls,
        .bowl-titleBlock { min-width: 0; }

        @media (orientation: portrait) and (max-width: 760px) {
          .bowl-header {
            padding: 12px 14px 6px !important;
            flex-wrap: wrap;
            gap: 8px;
          }
          .bowl-title { font-size: 20px !important; }
          .bowl-subtitle { font-size: 11px !important; }
          .bowl-headerControls { gap: 10px !important; }
          .bowl-headerControls .knob-label { display: none !important; }
          .bowl-headerControls input[type='range'] { width: 76px !important; }
          .bowl-footer {
            padding: 6px 6px 14px !important;
            gap: clamp(2px, 0.8vw, 6px) !important;
            justify-content: center !important;
            flex-wrap: nowrap !important;
          }
          .bowl-chip {
            width: clamp(40px, 11vw, 56px) !important;
            height: clamp(40px, 11vw, 56px) !important;
            flex: 0 0 auto;
          }
          .bowl-chip-note { font-size: clamp(16px, 4.6vw, 22px) !important; }
          .bowl-chip-name { display: none !important; }
          .bowl-hotkeys { display: none !important; }
          .bowl-hint { bottom: 14px !important; font-size: 11px !important; }
        }
        @media (orientation: landscape) and (max-height: 500px) {
          .bowl-main {
            grid-template-rows: auto 1fr !important;
            grid-template-columns: minmax(0, 1fr) auto !important;
            grid-template-areas: 'header header' 'stage footer' !important;
          }
          .bowl-header {
            grid-area: header;
            padding: 6px 14px 2px !important;
            flex-wrap: wrap;
            gap: 8px;
          }
          .bowl-title { font-size: 16px !important; }
          .bowl-subtitle { font-size: 10px !important; }
          .bowl-headerControls { gap: 10px !important; }
          .bowl-headerControls .knob-label { display: none !important; }
          .bowl-headerControls input[type='range'] { width: 72px !important; }
          .bowl-stage { grid-area: stage; }
          .bowl-footer {
            grid-area: footer;
            flex-direction: column !important;
            flex-wrap: nowrap !important;
            padding: 4px 10px 4px 4px !important;
            gap: 6px !important;
            justify-content: center !important;
            align-items: center;
          }
          .bowl-chip {
            width: 44px !important;
            height: 44px !important;
            flex: 0 0 auto;
          }
          .bowl-chip-name { display: none !important; }
          .bowl-hotkeys { display: none !important; }
          .bowl-hint { bottom: 8px !important; font-size: 10px !important; }
        }
      `}</style>
    </main>
  )
}

function BowlMark({ hue }: { hue: number }) {
  const id = `bm-${hue}`
  return (
    <svg width={26} height={26} viewBox="0 0 32 32" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <radialGradient id={`${id}-rim`} cx="0.35" cy="0.28" r="0.85">
          <stop offset="0" stopColor={`hsl(${hue} 40% 80%)`} />
          <stop offset="0.4" stopColor={`hsl(${hue} 45% 50%)`} />
          <stop offset="0.85" stopColor={`hsl(${hue} 55% 22%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 60% 12%)`} />
        </radialGradient>
        <radialGradient id={`${id}-well`} cx="0.5" cy="0.42" r="0.55">
          <stop offset="0" stopColor={`hsl(${hue} 60% 6%)`} />
          <stop offset="0.7" stopColor={`hsl(${hue} 55% 14%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 45% 24%)`} />
        </radialGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.55">
          <stop offset="0.55" stopColor={`hsl(${hue} 80% 65%)`} stopOpacity="0" />
          <stop offset="0.78" stopColor={`hsl(${hue} 80% 65%)`} stopOpacity="0.6" />
          <stop offset="1" stopColor={`hsl(${hue} 80% 65%)`} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill={`url(#${id}-glow)`} />
      <circle cx="16" cy="16" r="12.5" fill={`url(#${id}-rim)`} />
      <circle cx="16" cy="16" r="9" fill={`url(#${id}-well)`} />
      <circle cx="16" cy="16" r="12.5" fill="none" stroke={`hsl(${hue} 50% 85%)`} strokeOpacity="0.55" strokeWidth="0.6" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="0.6" />
    </svg>
  )
}

function Knob({
  label, value, onChange, hue,
}: { label: string; value: number; onChange: (v: number) => void; hue: number }) {
  return (
    <label className="knob" style={styles.knob}>
      <span className="knob-label" style={styles.knobLabel}>{label}</span>
      <input
        className="knob-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ ...styles.range, accentColor: `hsl(${hue} 70% 65%)` }}
      />
      <span className="knob-value" style={styles.knobValue}>{Math.round(value * 100)}</span>
    </label>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    background:
      'radial-gradient(120% 80% at 50% 0%, #16182a 0%, #0a0b13 55%, #06070d 100%)',
    color: 'var(--t1, #e4e5ea)',
    fontFamily: 'var(--sans, system-ui)',
    overflow: 'hidden',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 28px 12px',
  },
  titleBlock: { display: 'flex', flexDirection: 'column', gap: 2 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  title: {
    fontFamily: 'var(--serif, Georgia, serif)',
    fontSize: 28,
    letterSpacing: 0.5,
    transition: 'color 0.6s ease',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--t2, #9399a8)',
    letterSpacing: 0.3,
  },
  headerControls: {
    display: 'flex',
    gap: 18,
    alignItems: 'center',
  },
  backLink: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
    textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '6px 10px',
    borderRadius: 999,
    transition: 'color 0.2s ease, border-color 0.2s ease',
  },
  stage: {
    position: 'relative',
    minHeight: 0,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(6,7,13,0.45)',
    backdropFilter: 'blur(2px)',
    cursor: 'pointer',
  },
  overlayInner: {
    textAlign: 'center',
    padding: '28px 36px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    background: 'rgba(20,22,33,0.55)',
    maxWidth: 320,
  },
  overlayTitle: {
    fontFamily: 'var(--serif, Georgia, serif)',
    fontSize: 32,
    marginBottom: 8,
  },
  overlayText: { fontSize: 13, color: 'var(--t2, #9399a8)', lineHeight: 1.5 },
  hint: {
    position: 'absolute',
    left: 0, right: 0, bottom: 18,
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.4,
    pointerEvents: 'none',
    transition: 'opacity 600ms ease',
  },
  meter: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 6,
    width: 'min(380px, 60%)',
    height: 2,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    transition: 'width 80ms linear',
  },
  footer: {
    display: 'flex',
    gap: 10,
    padding: '14px 24px 22px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  bowlChip: {
    width: 70,
    height: 70,
    borderRadius: '50%',
    border: '2px solid transparent',
    color: 'rgba(255,255,255,0.92)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    transition: 'transform 160ms ease, box-shadow 240ms ease, border-color 240ms ease',
  },
  chipNote: {
    fontFamily: 'var(--serif, Georgia, serif)',
    fontSize: 22,
    lineHeight: 1,
  },
  chipName: {
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  knob: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: 'var(--t2, #9399a8)',
  },
  knobLabel: {
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontSize: 10,
  },
  range: {
    width: 110,
  },
  knobValue: {
    fontVariantNumeric: 'tabular-nums',
    width: 26,
    textAlign: 'right',
    color: 'var(--t1, #e4e5ea)',
  },
  retryBtn: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 36,
    padding: '10px 18px',
    borderRadius: 999,
    border: '1px solid rgba(216, 178, 96, 0.55)',
    background: 'rgba(20, 22, 33, 0.65)',
    color: '#d8b260',
    fontSize: 12,
    letterSpacing: 0.4,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    pointerEvents: 'auto',
  },
  hotkeys: {
    position: 'absolute',
    right: 16,
    bottom: 8,
    fontSize: 10,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.3)',
    pointerEvents: 'none',
  },
}
