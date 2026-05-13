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

    // Inharmonic partials approximate a real singing bowl's spectrum.
    // The slight detune between paired oscillators creates the
    // characteristic shimmering beat tone.
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
type Trail  = { x: number; y: number; t: number }

export default function Bowl() {
  const [bowlIdx, setBowlIdx] = useState(5)
  const [reverb, setReverb] = useState(0.45)
  const [volume, setVolume] = useState(0.75)
  const [started, setStarted] = useState(false)
  const [intensityDisplay, setIntensityDisplay] = useState(0)
  const [hint, setHint] = useState(true)

  const engineRef = useRef<BowlEngine | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  const bowl = BOWLS[bowlIdx]
  const hue = bowl.hue

  const stateRef = useRef({
    cx: 0, cy: 0, radius: 0,
    pointerActive: false,
    pointerOnRim: false,
    pointerX: 0, pointerY: 0,
    lastAngle: 0,
    lastT: 0,
    speed: 0,
    intensity: 0,
    targetIntensity: 0,
    ripples: [] as Ripple[],
    trails: [] as Trail[],
    sparks: Array.from({ length: 56 }, (_, i) => ({
      angle: (i / 56) * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      r: 0,
    })),
    hue,
    glowPulse: 0,
  })

  // keep hue current for the animation loop
  useEffect(() => { stateRef.current.hue = hue }, [hue])

  const ensureStarted = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new BowlEngine()
    await engineRef.current.resume()
    if (!engineRef.current.voice) engineRef.current.loadBowl(bowl.freq)
    setStarted(true)
  }, [bowl.freq])

  useEffect(() => {
    if (!started) return
    const id = setTimeout(() => setHint(false), 5000)
    return () => clearTimeout(id)
  }, [started])

  // swap bowl voice when selection changes
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
      // On mobile/compact viewports, push the bowl up to at least 0.8 of the
      // smaller viewport dimension. On desktop, preserve the original sizing
      // (0.36 × min(canvas)) since the layout already looks right.
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

  // Pointer handling
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return

    const localXY = (e: PointerEvent) => {
      const rect = cvs.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onDown = async (e: PointerEvent) => {
      const { x, y } = localXY(e)
      const s = stateRef.current
      const dx = x - s.cx, dy = y - s.cy
      const dist = Math.hypot(dx, dy)
      const inner = s.radius * 0.55
      const outer = s.radius * 1.05
      cvs.setPointerCapture(e.pointerId)
      await ensureStarted()
      if (dist < inner) {
        // Strike the bowl
        engineRef.current?.voice?.strike(0.6)
        spawnRipple(x, y, true)
        s.glowPulse = 1
        return
      }
      if (dist <= outer) {
        s.pointerActive = true
        s.pointerOnRim = true
        s.pointerX = x; s.pointerY = y
        s.lastAngle = Math.atan2(dy, dx)
        s.lastT = performance.now()
        s.speed = 0
      }
    }

    const onMove = (e: PointerEvent) => {
      const { x, y } = localXY(e)
      const s = stateRef.current
      s.pointerX = x; s.pointerY = y
      const dx = x - s.cx, dy = y - s.cy
      const dist = Math.hypot(dx, dy)
      const inner = s.radius * 0.55
      const outer = s.radius * 1.15
      const onRim = dist >= inner && dist <= outer
      s.pointerOnRim = onRim

      if (s.pointerActive && onRim) {
        const angle = Math.atan2(dy, dx)
        let d = angle - s.lastAngle
        // wrap into -PI..PI
        if (d > Math.PI) d -= Math.PI * 2
        if (d < -Math.PI) d += Math.PI * 2
        const now = performance.now()
        const dt = Math.max(1, now - s.lastT)
        const angVel = Math.abs(d) / (dt / 1000) // rad/s
        // smooth speed
        s.speed = s.speed * 0.7 + angVel * 0.3
        s.lastAngle = angle
        s.lastT = now
        s.targetIntensity = Math.min(1, s.speed / 6)
        // emit ripple at the touch point, modulated by speed
        if (Math.random() < 0.25 + s.targetIntensity * 0.5) {
          spawnRipple(x, y)
        }
        // trail
        s.trails.push({ x, y, t: now })
        if (s.trails.length > 60) s.trails.shift()
      }
    }

    const onUp = (e: PointerEvent) => {
      const s = stateRef.current
      s.pointerActive = false
      s.targetIntensity = 0
      try { cvs.releasePointerCapture(e.pointerId) } catch {}
    }

    const onLeave = () => {
      const s = stateRef.current
      s.pointerOnRim = false
    }

    cvs.addEventListener('pointerdown', onDown)
    cvs.addEventListener('pointermove', onMove)
    cvs.addEventListener('pointerup', onUp)
    cvs.addEventListener('pointercancel', onUp)
    cvs.addEventListener('pointerleave', onLeave)
    return () => {
      cvs.removeEventListener('pointerdown', onDown)
      cvs.removeEventListener('pointermove', onMove)
      cvs.removeEventListener('pointerup', onUp)
      cvs.removeEventListener('pointercancel', onUp)
      cvs.removeEventListener('pointerleave', onLeave)
    }
  }, [ensureStarted])

  const spawnRipple = (x: number, y: number, big = false) => {
    const s = stateRef.current
    s.ripples.push({
      x, y,
      r: big ? 12 : 4,
      alpha: big ? 1 : 0.85,
      hue: s.hue,
    })
    if (s.ripples.length > 60) s.ripples.shift()
  }

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

      // Smooth intensity toward target
      const decay = s.pointerActive ? 0.15 : 0.6
      s.intensity += (s.targetIntensity - s.intensity) * Math.min(1, decay * (dt * 60) / 8)

      // Glow pulse decay
      s.glowPulse *= Math.pow(0.001, dt)

      // Drive audio
      const v = engineRef.current?.voice
      if (v) {
        // Combine sustained circling level with strike-driven level
        const base = v.currentLevel()
        const target = Math.max(base * 0.92 ** (dt * 12), s.intensity * 0.85)
        if (s.pointerActive) v.setLevel(s.intensity * 0.85, 0.15)
        else if (target < base) v.setLevel(target, 0.4)
      }

      setIntensityDisplay(s.intensity)

      // ---- Render ----
      const w = cvs.clientWidth, h = cvs.clientHeight
      ctx.clearRect(0, 0, w, h)

      // Background ambient glow
      const bgGrad = ctx.createRadialGradient(s.cx, s.cy, s.radius * 0.2, s.cx, s.cy, s.radius * 3)
      const ambient = 0.18 + s.intensity * 0.18 + s.glowPulse * 0.12
      bgGrad.addColorStop(0, `hsla(${s.hue}, 60%, 35%, ${ambient})`)
      bgGrad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // Outer glow ring
      const glowR = s.radius * (1.05 + s.intensity * 0.06 + s.glowPulse * 0.08)
      const glow = ctx.createRadialGradient(s.cx, s.cy, s.radius * 0.7, s.cx, s.cy, glowR * 1.7)
      glow.addColorStop(0, `hsla(${s.hue}, 80%, 60%, 0)`)
      glow.addColorStop(0.45, `hsla(${s.hue}, 80%, 60%, ${0.18 + s.intensity * 0.35})`)
      glow.addColorStop(1, `hsla(${s.hue}, 80%, 60%, 0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, glowR * 1.7, 0, Math.PI * 2)
      ctx.fill()

      // Bowl body — metallic radial gradient
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

      // Inner well (darker recessed center) suggesting a bowl seen from above
      const wellR = s.radius * 0.78
      const well = ctx.createRadialGradient(s.cx, s.cy - s.radius * 0.05, wellR * 0.05, s.cx, s.cy, wellR)
      well.addColorStop(0, `hsla(${s.hue}, 60%, 8%, 1)`)
      well.addColorStop(0.7, `hsla(${s.hue}, 50%, 14%, 1)`)
      well.addColorStop(1, `hsla(${s.hue}, 40%, 28%, 0)`)
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, wellR, 0, Math.PI * 2)
      ctx.fillStyle = well
      ctx.fill()

      // Inner ripple-like rings inside the well, intensifying with sound
      ctx.save()
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, wellR, 0, Math.PI * 2)
      ctx.clip()
      const ringCount = 6
      for (let i = 0; i < ringCount; i++) {
        const phase = (now / 1400 + i / ringCount) % 1
        const rr = phase * wellR
        const a = (1 - phase) * (0.05 + s.intensity * 0.35)
        ctx.beginPath()
        ctx.arc(s.cx, s.cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${s.hue}, 70%, 70%, ${a})`
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      ctx.restore()

      // Rim highlight
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.radius * 0.99, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${s.hue}, 50%, 80%, 0.55)`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Inner rim shadow
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.radius * 0.78, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 2
      ctx.stroke()

      // Orbiting sparks on the rim
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

      // Trail behind cursor on rim
      if (s.trails.length > 1) {
        ctx.lineCap = 'round'
        for (let i = 1; i < s.trails.length; i++) {
          const a = i / s.trails.length
          const p0 = s.trails[i - 1]
          const p1 = s.trails[i]
          const age = (now - p1.t) / 600
          if (age > 1) continue
          ctx.strokeStyle = `hsla(${s.hue}, 90%, 80%, ${(1 - age) * a * 0.7})`
          ctx.lineWidth = 1.5 + (1 - age) * 4 * s.intensity
          ctx.beginPath()
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(p1.x, p1.y)
          ctx.stroke()
        }
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

      // Mallet indicator
      if (s.pointerOnRim) {
        const mr = 10 + s.intensity * 10
        const grad = ctx.createRadialGradient(s.pointerX, s.pointerY, 0, s.pointerX, s.pointerY, mr)
        grad.addColorStop(0, `hsla(${s.hue}, 95%, 92%, ${0.7 + s.intensity * 0.3})`)
        grad.addColorStop(1, `hsla(${s.hue}, 95%, 70%, 0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(s.pointerX, s.pointerY, mr, 0, Math.PI * 2)
        ctx.fill()
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
        await ensureStarted()
        engineRef.current?.voice?.strike(0.6)
        const s = stateRef.current
        s.glowPulse = 1
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ensureStarted])

  const cssHue = useMemo(() => `hsl(${hue} 70% 65%)`, [hue])

  return (
    <main className="bowl-main" style={styles.main}>
      <header className="bowl-header" style={styles.header}>
        <div className="bowl-titleBlock" style={styles.titleBlock}>
          <div style={styles.titleRow}>
            <BowlMark hue={hue} />
            <div className="bowl-title" style={{ ...styles.title, color: cssHue }}>Singing Bowl</div>
          </div>
          <div className="bowl-subtitle" style={styles.subtitle}>{bowl.name} · {bowl.note} · {bowl.desc}</div>
        </div>
        <div className="bowl-headerControls" style={styles.headerControls}>
          <Knob
            label="Reverb"
            value={reverb}
            onChange={setReverb}
            hue={hue}
          />
          <Knob
            label="Volume"
            value={volume}
            onChange={setVolume}
            hue={hue}
          />
        </div>
      </header>

      <div className="bowl-stage" style={styles.stage}>
        <canvas ref={canvasRef} className="bowl-canvas" style={styles.canvas} />
        {!started && (
          <div style={styles.overlay} onPointerDown={ensureStarted}>
            <div style={styles.overlayInner}>
              <div style={{ ...styles.overlayTitle, color: cssHue }}>Begin</div>
              <div style={styles.overlayText}>Tap or click anywhere on the bowl to awaken it.</div>
            </div>
          </div>
        )}
        {started && hint && (
          <div className="bowl-hint" style={styles.hint}>
            Trace the rim slowly. Tap the centre to strike.
          </div>
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
              onClick={async () => { setBowlIdx(i); await ensureStarted() }}
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
        /* Without an explicit column template the grid column defaults to
           'auto' and expands to fit the widest child — on a 390 px iPhone
           that's the header, which pushes both the canvas and the chip row
           wider than the viewport. Pin the column to 100% and let the grid
           items shrink. */
        .bowl-main { grid-template-columns: minmax(0, 1fr); }
        .bowl-header,
        .bowl-stage,
        .bowl-footer,
        .bowl-headerControls,
        .bowl-titleBlock { min-width: 0; }

        /* Mobile portrait: keep all 7 chips on a single row by sizing them
           with clamp(40px, 11vw, 56px) and using nowrap so they don't fall
           to a second row. The 40 px floor preserves the touch target. */
        @media (orientation: portrait) and (max-width: 760px) {
          .bowl-header {
            padding: 12px 14px 6px !important;
            flex-wrap: wrap;
            gap: 8px;
          }
          .bowl-title { font-size: 22px !important; }
          .bowl-subtitle { font-size: 11px !important; }
          .bowl-headerControls { gap: 12px !important; }
          .bowl-headerControls .knob-label { display: none !important; }
          .bowl-headerControls input[type='range'] { width: 80px !important; }
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
        /* Mobile landscape: stage on the left, chips stacked vertically
           on the right. Same minmax guard on the stage column. */
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
          .bowl-title { font-size: 18px !important; }
          .bowl-subtitle { font-size: 10px !important; }
          .bowl-headerControls { gap: 12px !important; }
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
        style={{
          ...styles.range,
          accentColor: `hsl(${hue} 70% 65%)`,
        }}
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
    cursor: 'crosshair',
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
  },
  overlayTitle: {
    fontFamily: 'var(--serif, Georgia, serif)',
    fontSize: 32,
    marginBottom: 8,
  },
  overlayText: { fontSize: 13, color: 'var(--t2, #9399a8)' },
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
