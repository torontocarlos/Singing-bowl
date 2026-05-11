'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';

type Note = {
  note: string;
  freq: number;
  color: string;
  glow: [number, number, number];
};

const NOTES: Note[] = [
  { note: 'C', freq: 261.63, color: '#ff708e', glow: [255, 132, 162] },
  { note: 'D', freq: 293.66, color: '#ff995c', glow: [255, 168, 110] },
  { note: 'E', freq: 329.63, color: '#ffd360', glow: [255, 220, 130] },
  { note: 'F', freq: 349.23, color: '#7ee08b', glow: [142, 232, 168] },
  { note: 'G', freq: 392.0, color: '#75c8ee', glow: [142, 210, 240] },
  { note: 'A', freq: 440.0, color: '#a294e6', glow: [180, 168, 240] },
  { note: 'B', freq: 493.88, color: '#c98be0', glow: [216, 156, 234] },
  { note: 'C↑', freq: 523.25, color: '#ff9ec7', glow: [255, 188, 218] }
];

const PARTIALS = [
  { ratio: 1, beat: 0.5, gain: 1.0, decay: 4.6 },
  { ratio: 2.76, beat: 1.1, gain: 0.45, decay: 3.2 },
  { ratio: 5.4, beat: 1.8, gain: 0.26, decay: 2.2 },
  { ratio: 8.93, beat: 2.6, gain: 0.13, decay: 1.4 },
  { ratio: 13.34, beat: 3.6, gain: 0.06, decay: 0.9 }
];

const HAPPY_BIRTHDAY: { idx: number; dur: number }[] = [
  { idx: 0, dur: 0.5 }, { idx: 0, dur: 0.5 }, { idx: 1, dur: 1 }, { idx: 0, dur: 1 }, { idx: 3, dur: 1 }, { idx: 2, dur: 2 },
  { idx: 0, dur: 0.5 }, { idx: 0, dur: 0.5 }, { idx: 1, dur: 1 }, { idx: 0, dur: 1 }, { idx: 4, dur: 1 }, { idx: 3, dur: 2 },
  { idx: 0, dur: 0.5 }, { idx: 0, dur: 0.5 }, { idx: 7, dur: 1 }, { idx: 5, dur: 1 }, { idx: 3, dur: 1 }, { idx: 2, dur: 1.5 }, { idx: 1, dur: 1.5 },
  { idx: 6, dur: 0.5 }, { idx: 6, dur: 0.5 }, { idx: 5, dur: 1 }, { idx: 3, dur: 1 }, { idx: 4, dur: 1 }, { idx: 3, dur: 2 }
];

class BowlAudio {
  ctx: AudioContext;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;

  constructor() {
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    this.dry = this.ctx.createGain();
    this.wet = this.ctx.createGain();
    this.dry.gain.value = 0.75;
    this.wet.gain.value = 0.4;

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.buildImpulse(3.4, 2.2);

    this.dry.connect(this.master);
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
  }

  private buildImpulse(seconds: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const noise = Math.random() * 2 - 1;
        last = last * 0.55 + noise * 0.45;
        data[i] = last * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(v, now + 0.06);
  }

  strikeAt(freq: number, at: number, energy = 1) {
    const start = at;
    const e = Math.max(0.1, Math.min(1.4, energy));
    for (const { ratio, beat, gain, decay } of PARTIALS) {
      const f = freq * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(gain * e * 0.55, start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      g.connect(this.dry);
      g.connect(this.convolver);
      for (const d of [-beat / 2, beat / 2]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f + d;
        osc.connect(g);
        osc.start(start);
        osc.stop(start + decay + 0.3);
      }
    }
  }

  strike(freq: number, energy = 1) {
    this.strikeAt(freq, this.ctx.currentTime + 0.005, energy);
  }

  now() {
    return this.ctx.currentTime;
  }

  dispose() {
    try {
      void this.ctx.close();
    } catch {}
  }
}

type Confetti = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  hue: number;
  alpha: number;
};

export default function Home() {
  const audioRef = useRef<BowlAudio | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const confettiRef = useRef<Confetti[]>([]);
  const burstSourceRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  const [volume, setVolume] = useState(0.75);
  const [litCandles, setLitCandles] = useState<Set<number>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new BowlAudio();
      audioRef.current.setVolume(volume);
      setAudioReady(true);
    }
    audioRef.current.resume();
    return audioRef.current;
  }, [volume]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
  }, [volume]);

  const lightCandle = useCallback((idx: number, ms: number) => {
    setLitCandles((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    const t = window.setTimeout(() => {
      setLitCandles((prev) => {
        if (!prev.has(idx)) return prev;
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }, ms);
    timeoutsRef.current.push(t);
  }, []);

  const spawnBurst = useCallback((x: number, y: number, hue: number, count = 18) => {
    burstSourceRef.current = { x, y, t: performance.now() };
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      confettiRef.current.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        w: 4 + Math.random() * 5,
        h: 6 + Math.random() * 8,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
        hue: (hue + Math.random() * 60 - 30 + 360) % 360,
        alpha: 1
      });
    }
  }, []);

  const playNote = useCallback(
    (idx: number, fromEl?: HTMLElement) => {
      const audio = ensureAudio();
      audio.strike(NOTES[idx].freq, 1);
      lightCandle(idx, 1100);
      if (fromEl && canvasRef.current) {
        const rect = fromEl.getBoundingClientRect();
        const cRect = canvasRef.current.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - cRect.left;
        const y = rect.top + rect.height * 0.18 - cRect.top;
        const hue = (NOTES[idx].glow[0] + NOTES[idx].glow[2]) / 2;
        const colorHue =
          idx === 0 ? 350 : idx === 1 ? 22 : idx === 2 ? 48 : idx === 3 ? 138 : idx === 4 ? 200 : idx === 5 ? 252 : idx === 6 ? 290 : 325;
        spawnBurst(x, y, colorHue, 14);
        void hue;
      }
    },
    [ensureAudio, lightCandle, spawnBurst]
  );

  const stopHappyBirthday = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
    setLitCandles(new Set());
    setIsPlaying(false);
  }, []);

  const playHappyBirthday = useCallback(() => {
    const audio = ensureAudio();
    stopHappyBirthday();
    setIsPlaying(true);
    const tempo = 108;
    const beat = 60 / tempo;
    const songStart = audio.now() + 0.15;
    let when = 0;
    for (const note of HAPPY_BIRTHDAY) {
      audio.strikeAt(NOTES[note.idx].freq, songStart + when, 1);
      const flashAt = (when + 0.15) * 1000;
      const dur = note.dur * beat * 1000;
      const idx = note.idx;
      const t1 = window.setTimeout(() => {
        setLitCandles((prev) => {
          const next = new Set(prev);
          next.add(idx);
          return next;
        });
        const el = document.querySelector<HTMLElement>(`[data-candle="${idx}"]`);
        if (el && canvasRef.current) {
          const rect = el.getBoundingClientRect();
          const cRect = canvasRef.current.getBoundingClientRect();
          const colorHue =
            idx === 0 ? 350 : idx === 1 ? 22 : idx === 2 ? 48 : idx === 3 ? 138 : idx === 4 ? 200 : idx === 5 ? 252 : idx === 6 ? 290 : 325;
          spawnBurst(rect.left + rect.width / 2 - cRect.left, rect.top + rect.height * 0.18 - cRect.top, colorHue, 8);
        }
      }, flashAt);
      const t2 = window.setTimeout(() => {
        setLitCandles((prev) => {
          if (!prev.has(idx)) return prev;
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
      }, flashAt + Math.min(dur * 0.85, 1100));
      timeoutsRef.current.push(t1, t2);
      when += note.dur * beat;
    }
    const tEnd = window.setTimeout(() => {
      setIsPlaying(false);
      setLitCandles(new Set());
      const cake = document.querySelector<HTMLElement>('.cake-wrap');
      if (cake && canvasRef.current) {
        const r = cake.getBoundingClientRect();
        const c = canvasRef.current.getBoundingClientRect();
        spawnBurst(r.left + r.width / 2 - c.left, r.top + r.height * 0.3 - c.top, 320, 80);
      }
    }, (when + 0.3) * 1000);
    timeoutsRef.current.push(tEnd);
  }, [ensureAudio, spawnBurst, stopHappyBirthday]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const ambient: Confetti[] = [];
    for (let i = 0; i < 36; i++) {
      ambient.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 18,
        vy: -8 - Math.random() * 18,
        w: 3 + Math.random() * 3,
        h: 6 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 1.2,
        hue: Math.random() * 360,
        alpha: 0.45 + Math.random() * 0.4
      });
    }

    let prevTs = performance.now();
    const draw = (ts: number) => {
      const dt = Math.min(0.05, (ts - prevTs) / 1000);
      prevTs = ts;
      ctx.clearRect(0, 0, w, h);

      for (const p of ambient) {
        p.y += p.vy * dt;
        p.x += p.vx * dt;
        p.vy += 4 * dt;
        p.rot += p.vr * dt;
        if (p.y < -20) {
          p.x = Math.random() * w;
          p.y = h + 20;
          p.vx = (Math.random() - 0.5) * 18;
          p.vy = -8 - Math.random() * 18;
          p.hue = Math.random() * 360;
        }
        if (p.x < -30) p.x = w + 30;
        if (p.x > w + 30) p.x = -30;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 75%, ${p.alpha * 0.55})`;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      const bursts = confettiRef.current;
      for (let i = bursts.length - 1; i >= 0; i--) {
        const p = bursts[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 380 * dt;
        p.vx *= 0.985;
        p.rot += p.vr * dt;
        p.alpha -= dt * 0.55;
        if (p.alpha <= 0 || p.y > h + 40) {
          bursts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${Math.max(0, p.alpha)})`;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (bursts.length > 600) bursts.splice(0, bursts.length - 600);

      rafRef.current = window.requestAnimationFrame(draw);
    };
    rafRef.current = window.requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlaying) stopHappyBirthday();
        else playHappyBirthday();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 8) {
        const el = document.querySelector<HTMLElement>(`[data-candle="${n - 1}"]`);
        playNote(n - 1, el ?? undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, playHappyBirthday, playNote, stopHappyBirthday]);

  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current) clearTimeout(t);
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const sprinkles = useMemo(() => {
    const seed = (i: number) => {
      const x = Math.sin(i * 4137.13) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: 22 }).map((_, i) => ({
      hue: Math.floor(seed(i + 1) * 360),
      x: seed(i + 11) * 90 + 5,
      y: seed(i + 21) * 60 + 18,
      r: seed(i + 31) * 360,
      s: 0.7 + seed(i + 41) * 0.5
    }));
  }, []);

  return (
    <div className="shell">
      <canvas ref={canvasRef} className="confetti-canvas" aria-hidden />
      <div className="aurora" aria-hidden />

      <header className="header">
        <h1 className="title">Birthday Bowl</h1>
        <div className="controls">
          <label className="volume">
            <span className="volume-label">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </label>
          <button
            type="button"
            className={`cake-btn${isPlaying ? ' playing' : ''}`}
            onClick={() => (isPlaying ? stopHappyBirthday() : playHappyBirthday())}
            title={isPlaying ? 'Stop' : 'Play Happy Birthday'}
            aria-label={isPlaying ? 'Stop Happy Birthday' : 'Play Happy Birthday'}
          >
            <span aria-hidden>{isPlaying ? '✦' : '🎂'}</span>
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="cake-wrap">
          <div className="candles" role="group" aria-label="Eight tuned candles">
            {NOTES.map((n, i) => {
              const offset = -Math.sin((i / 7) * Math.PI) * 12;
              return (
                <button
                  key={n.note}
                  type="button"
                  data-candle={i}
                  className={`candle${litCandles.has(i) ? ' lit' : ''}`}
                  style={
                    {
                      '--wax': n.color,
                      '--glow': `${n.glow[0]}, ${n.glow[1]}, ${n.glow[2]}`,
                      '--lift': `${offset}px`
                    } as React.CSSProperties
                  }
                  onPointerDown={(e) => playNote(i, e.currentTarget)}
                  aria-label={`Play ${n.note}, ${n.freq.toFixed(2)} hertz`}
                >
                  <span className="candle-key" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="flame" aria-hidden>
                    <span className="flame-glow" />
                    <span className="flame-body" />
                    <span className="flame-core" />
                  </span>
                  <span className="wick" aria-hidden />
                  <span className="wax" aria-hidden>
                    <span className="wax-shine" />
                  </span>
                  <span className="candle-note" aria-hidden>
                    {n.note}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cake">
            <div className="frosting">
              {Array.from({ length: 17 }).map((_, k) => (
                <span key={k} className="drip" style={{ '--i': k } as React.CSSProperties} />
              ))}
              <div className="sprinkles" aria-hidden>
                {sprinkles.map((s, i) => (
                  <span
                    key={i}
                    className="sprinkle"
                    style={
                      {
                        '--sprinkle-hue': s.hue,
                        '--sprinkle-x': `${s.x}%`,
                        '--sprinkle-y': `${s.y}%`,
                        '--sprinkle-rot': `${s.r}deg`,
                        '--sprinkle-scale': s.s
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            </div>
            <div className="layer" />
            <div className="plate" aria-hidden />
          </div>
        </div>
        <p className={`hint${audioReady ? ' faded' : ''}`}>
          Tap a candle to ring its bowl. Press 1–8 or the spacebar.
        </p>
      </main>

      <style jsx>{`
        .shell {
          position: relative;
          width: 100vw;
          height: 100dvh;
          min-height: 100vh;
          overflow: hidden;
          isolation: isolate;
        }

        .confetti-canvas {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
        }

        .aurora {
          position: absolute;
          inset: -20%;
          z-index: 0;
          background:
            radial-gradient(circle at 20% 30%, rgba(255, 180, 220, 0.35), transparent 45%),
            radial-gradient(circle at 80% 20%, rgba(255, 220, 160, 0.3), transparent 50%),
            radial-gradient(circle at 60% 80%, rgba(120, 200, 240, 0.28), transparent 55%);
          filter: blur(30px);
          animation: drift 22s ease-in-out infinite alternate;
          pointer-events: none;
        }
        @keyframes drift {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          100% {
            transform: translate(2%, -2%) rotate(8deg);
          }
        }

        .header {
          position: relative;
          z-index: 4;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: clamp(12px, 2.4vmin, 22px) clamp(14px, 3vmin, 28px);
          gap: clamp(12px, 2vmin, 22px);
        }
        .title {
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(22px, 3.6vmin, 34px);
          color: #fff;
          letter-spacing: 0.01em;
          text-shadow: 0 0 18px rgba(255, 200, 220, 0.55), 0 2px 12px rgba(0, 0, 0, 0.4);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .controls {
          display: flex;
          align-items: center;
          gap: clamp(10px, 2vmin, 18px);
        }
        .volume {
          display: flex;
          align-items: center;
          gap: 10px;
          color: rgba(255, 245, 238, 0.85);
        }
        .volume-label {
          font-size: clamp(11px, 1.6vmin, 13px);
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .volume input {
          width: clamp(90px, 18vmin, 160px);
        }
        .cake-btn {
          width: clamp(40px, 6vmin, 48px);
          height: clamp(40px, 6vmin, 48px);
          border-radius: 50%;
          font-size: clamp(20px, 3vmin, 24px);
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.18);
          opacity: 0.55;
          transition: opacity 0.3s ease, transform 0.3s ease, background 0.3s ease,
            box-shadow 0.3s ease;
          display: grid;
          place-items: center;
        }
        .cake-btn:hover {
          opacity: 1;
          transform: translateY(-1px) scale(1.05);
          background: rgba(255, 220, 240, 0.18);
          box-shadow: 0 0 18px rgba(255, 180, 220, 0.5);
        }
        .cake-btn.playing {
          opacity: 1;
          background: linear-gradient(180deg, rgba(255, 220, 240, 0.4), rgba(255, 170, 200, 0.3));
          box-shadow: 0 0 24px rgba(255, 180, 220, 0.7);
          animation: shimmy 0.7s ease-in-out infinite;
        }
        @keyframes shimmy {
          0%, 100% {
            transform: rotate(-4deg) scale(1);
          }
          50% {
            transform: rotate(4deg) scale(1.08);
          }
        }

        .stage {
          position: relative;
          z-index: 2;
          height: calc(100dvh - clamp(58px, 9vmin, 78px));
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 0 clamp(12px, 3vmin, 24px) clamp(20px, 6vmin, 60px);
          gap: clamp(12px, 2vmin, 22px);
          pointer-events: none;
        }
        .cake-wrap {
          position: relative;
          width: 100%;
          max-width: 640px;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: auto;
        }

        .candles {
          position: relative;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: clamp(4px, 1.2vmin, 10px);
          padding-bottom: 6px;
          z-index: 3;
        }
        .candle {
          position: relative;
          width: clamp(34px, 6.8vmin, 56px);
          height: clamp(110px, 22vmin, 170px);
          background: transparent;
          border: 0;
          padding: 0;
          cursor: pointer;
          transform: translateY(var(--lift, 0));
          transition: transform 0.25s ease;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .candle::before {
          content: '';
          position: absolute;
          inset: -10px;
        }
        .candle:hover {
          transform: translateY(calc(var(--lift, 0px) - 3px));
        }
        .candle:active {
          transform: translateY(var(--lift, 0px));
        }
        .candle.lit {
          transform: translateY(calc(var(--lift, 0px) - 6px));
        }

        .wax {
          position: absolute;
          left: 18%;
          right: 18%;
          bottom: 0;
          height: 62%;
          border-radius: 10px 10px 5px 5px;
          background: linear-gradient(
            180deg,
            color-mix(in oklab, var(--wax), white 18%),
            var(--wax) 35%,
            color-mix(in oklab, var(--wax), black 32%) 100%
          );
          box-shadow:
            inset -4px 0 0 rgba(0, 0, 0, 0.18),
            inset 4px 0 0 rgba(255, 255, 255, 0.22),
            0 6px 14px rgba(0, 0, 0, 0.25);
        }
        .wax-shine {
          position: absolute;
          top: 8%;
          left: 28%;
          width: 18%;
          height: 55%;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0));
          border-radius: 50%;
          filter: blur(0.5px);
        }
        .wick {
          position: absolute;
          left: calc(50% - 1px);
          bottom: 62%;
          width: 2px;
          height: 7%;
          background: #2a1408;
          border-radius: 1px;
        }
        .flame {
          position: absolute;
          left: 50%;
          bottom: calc(62% + 6%);
          transform: translateX(-50%);
          width: 36%;
          height: 22%;
          opacity: 0;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .candle.lit .flame {
          opacity: 1;
          animation: flicker 0.32s ease-in-out infinite alternate;
        }
        .flame-glow {
          position: absolute;
          inset: -120% -90% -110% -90%;
          background: radial-gradient(
            ellipse 50% 50% at 50% 60%,
            rgba(var(--glow), 0.55),
            rgba(var(--glow), 0.1) 50%,
            rgba(var(--glow), 0) 70%
          );
          pointer-events: none;
        }
        .flame-body {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 55% 70% at 50% 65%,
            #fff5b8 0%,
            #ffd56b 35%,
            #ff8a3b 72%,
            transparent 100%
          );
          border-radius: 50% 50% 40% 40% / 70% 70% 35% 35%;
          filter: blur(0.4px);
        }
        .flame-core {
          position: absolute;
          left: 50%;
          bottom: 30%;
          transform: translateX(-50%);
          width: 30%;
          height: 40%;
          background: radial-gradient(ellipse at 50% 60%, #fff 0%, #fff7c4 50%, transparent 100%);
          border-radius: 50%;
          filter: blur(0.6px);
        }
        @keyframes flicker {
          0% {
            transform: translateX(-50%) scale(1) rotate(-3deg);
          }
          100% {
            transform: translateX(-50%) scale(1.1) rotate(3deg);
          }
        }
        .candle-note {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 14%;
          text-align: center;
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(13px, 2vmin, 18px);
          color: rgba(255, 255, 255, 0.96);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
          pointer-events: none;
        }
        .candle-key {
          position: absolute;
          top: -6px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: clamp(9px, 1.3vmin, 11px);
          letter-spacing: 0.16em;
          color: rgba(255, 245, 238, 0.55);
          pointer-events: none;
        }

        .cake {
          position: relative;
          width: clamp(280px, 86vw, 520px);
          height: clamp(74px, 14vmin, 118px);
          margin-top: -2px;
        }
        .layer {
          position: absolute;
          left: 4%;
          right: 4%;
          top: 22%;
          bottom: 14%;
          background: linear-gradient(180deg, var(--cream-1) 0%, var(--cream-2) 60%, var(--cream-3) 100%);
          border-radius: 18px 18px 10px 10px;
          box-shadow:
            inset 0 -10px 18px rgba(80, 30, 0, 0.16),
            inset 0 6px 10px rgba(255, 255, 255, 0.35),
            0 16px 36px rgba(40, 5, 30, 0.45);
        }
        .frosting {
          position: absolute;
          left: 4%;
          right: 4%;
          top: 0;
          height: 50%;
          background: linear-gradient(180deg, #ffffff 0%, var(--frosting) 60%, #ffe4ea 100%);
          border-radius: 18px 18px 8px 8px;
          z-index: 2;
          box-shadow: 0 4px 10px rgba(255, 220, 230, 0.25);
        }
        .drip {
          position: absolute;
          bottom: -8px;
          left: calc(var(--i) * (100% / 17) - 3px);
          width: calc(100% / 17 + 6px);
          height: 16px;
          background: linear-gradient(180deg, #ffffff 0%, var(--frosting) 70%, #ffe4ea 100%);
          border-radius: 0 0 60% 60% / 0 0 100% 100%;
          box-shadow: 0 4px 6px rgba(255, 200, 215, 0.25);
        }
        .sprinkles {
          position: absolute;
          inset: 8% 6%;
          z-index: 3;
          pointer-events: none;
        }
        .sprinkle {
          position: absolute;
          left: var(--sprinkle-x);
          top: var(--sprinkle-y);
          width: 10px;
          height: 3px;
          background: hsl(var(--sprinkle-hue), 90%, 65%);
          border-radius: 2px;
          transform: rotate(var(--sprinkle-rot)) scale(var(--sprinkle-scale, 1));
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
        }
        .plate {
          position: absolute;
          left: -4%;
          right: -4%;
          bottom: -2%;
          height: 22%;
          background: radial-gradient(ellipse at 50% 35%, #fff7e0 0%, #d8a26a 60%, #8e5a30 100%);
          border-radius: 50%;
          box-shadow: 0 18px 36px rgba(40, 5, 30, 0.55);
          z-index: 0;
        }

        .hint {
          color: rgba(255, 245, 238, 0.7);
          font-size: clamp(11px, 1.7vmin, 13px);
          letter-spacing: 0.06em;
          margin: 0;
          transition: opacity 0.6s ease;
          pointer-events: none;
        }
        .hint.faded {
          opacity: 0.4;
        }

        @media (max-width: 460px) {
          .volume-label {
            display: none;
          }
        }
        @media (max-width: 360px) {
          .volume input {
            width: 84px;
          }
        }
      `}</style>
    </div>
  );
}
