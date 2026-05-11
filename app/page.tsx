'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';

type Note = {
  note: string;
  freq: number;
  hue: number;
  glow: [number, number, number];
  label: string;
};

const NOTES: Note[] = [
  { note: 'C', freq: 130.81, hue: 355, glow: [240, 110, 150], label: 'Root' },
  { note: 'D', freq: 146.83, hue: 22, glow: [240, 155, 95], label: 'Sacral' },
  { note: 'E', freq: 164.81, hue: 48, glow: [240, 215, 115], label: 'Solar' },
  { note: 'F', freq: 174.61, hue: 138, glow: [140, 225, 175], label: 'Heart' },
  { note: 'G', freq: 196.0, hue: 200, glow: [135, 215, 240], label: 'Throat' },
  { note: 'A', freq: 220.0, hue: 250, glow: [170, 165, 245], label: 'Brow' },
  { note: 'B', freq: 246.94, hue: 290, glow: [220, 165, 245], label: 'Crown' },
  { note: 'C↑', freq: 261.63, hue: 325, glow: [250, 195, 235], label: 'Soul' }
];

type Mode = 'fairy' | 'zen' | 'psychedelic' | 'techno';

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'fairy', label: 'Fairy', short: 'F' },
  { id: 'zen', label: 'Zen', short: 'Z' },
  { id: 'psychedelic', label: 'Psychedelic', short: 'P' },
  { id: 'techno', label: 'Techno', short: 'T' }
];

const MODE_AUDIO: Record<Mode, { vibratoRate: number; vibratoDepth: number }> = {
  fairy: { vibratoRate: 4.2, vibratoDepth: 4.0 },
  zen: { vibratoRate: 5.2, vibratoDepth: 2.4 },
  psychedelic: { vibratoRate: 3.6, vibratoDepth: 5.5 },
  techno: { vibratoRate: 7.4, vibratoDepth: 1.0 }
};

const COUNT_OPTIONS = [1, 2, 4] as const;
type BowlCount = (typeof COUNT_OPTIONS)[number];

const DEFAULT_NOTES_BY_COUNT: Record<BowlCount, number[]> = {
  1: [3],
  2: [0, 4],
  4: [0, 2, 4, 7]
};

const PARTIALS = [
  { ratio: 1, beat: 0.4, gain: 1.0, decay: 6.5 },
  { ratio: 2.76, beat: 1.1, gain: 0.55, decay: 4.5 },
  { ratio: 5.4, beat: 1.8, gain: 0.32, decay: 3.2 },
  { ratio: 8.93, beat: 2.6, gain: 0.17, decay: 2.2 },
  { ratio: 13.34, beat: 3.6, gain: 0.09, decay: 1.4 }
];

class BowlEngine {
  ctx: AudioContext;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
  vibrato: OscillatorNode;
  vibratoGain: GainNode;
  voices: Map<number, { gain: GainNode; oscs: OscillatorNode[] }> = new Map();

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
    this.dry.gain.value = 0.65;
    this.wet.gain.value = 0.5;

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.buildImpulse(4.2, 2.4);

    this.dry.connect(this.master);
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);

    this.vibrato = this.ctx.createOscillator();
    this.vibrato.frequency.value = 4.2;
    this.vibratoGain = this.ctx.createGain();
    this.vibratoGain.gain.value = 4.0;
    this.vibrato.connect(this.vibratoGain);
    this.vibrato.start();
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
        last = last * 0.5 + noise * 0.5;
        data[i] = last * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMasterVolume(v: number) {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(v, now + 0.08);
  }

  setReverbMix(v: number) {
    const now = this.ctx.currentTime;
    this.wet.gain.cancelScheduledValues(now);
    this.dry.gain.cancelScheduledValues(now);
    this.wet.gain.linearRampToValueAtTime(v, now + 0.08);
    this.dry.gain.linearRampToValueAtTime(0.4 + (1 - v) * 0.45, now + 0.08);
  }

  setVibrato(rate: number, depth: number) {
    const now = this.ctx.currentTime;
    this.vibrato.frequency.cancelScheduledValues(now);
    this.vibratoGain.gain.cancelScheduledValues(now);
    this.vibrato.frequency.linearRampToValueAtTime(rate, now + 0.4);
    this.vibratoGain.gain.linearRampToValueAtTime(depth, now + 0.4);
  }

  strike(freq: number, energy: number) {
    const now = this.ctx.currentTime;
    const e = Math.max(0.05, Math.min(1.4, energy));
    for (const { ratio, beat, gain, decay } of PARTIALS) {
      const f = freq * ratio;
      const pGain = this.ctx.createGain();
      pGain.gain.setValueAtTime(0, now);
      pGain.gain.linearRampToValueAtTime(gain * e * 0.55, now + 0.008);
      pGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      pGain.connect(this.dry);
      pGain.connect(this.convolver);
      for (const detune of [-beat / 2, beat / 2]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f + detune;
        this.vibratoGain.connect(osc.frequency);
        osc.connect(pGain);
        osc.start(now);
        osc.stop(now + decay + 0.4);
      }
    }
  }

  startSustain(voiceId: number, freq: number) {
    this.stopSustain(voiceId, true);
    const now = this.ctx.currentTime;
    const bus = this.ctx.createGain();
    bus.gain.value = 0;
    bus.connect(this.dry);
    bus.connect(this.convolver);

    const oscs: OscillatorNode[] = [];
    for (const { ratio, beat, gain } of PARTIALS) {
      const f = freq * ratio;
      const pGain = this.ctx.createGain();
      pGain.gain.value = gain * 0.45;
      pGain.connect(bus);
      for (const detune of [-beat / 2, beat / 2]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f + detune;
        this.vibratoGain.connect(osc.frequency);
        osc.connect(pGain);
        osc.start(now);
        oscs.push(osc);
      }
    }
    this.voices.set(voiceId, { gain: bus, oscs });
  }

  setSustainLevel(voiceId: number, v: number) {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), now + 0.06);
  }

  stopSustain(voiceId: number, fast = false) {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    const now = this.ctx.currentTime;
    const tail = fast ? 0.05 : 0.9;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + tail);
    const v = voice;
    window.setTimeout(() => {
      for (const o of v.oscs) {
        try {
          o.stop();
        } catch {}
        try {
          o.disconnect();
        } catch {}
      }
      try {
        v.gain.disconnect();
      } catch {}
    }, (tail + 0.1) * 1000);
    this.voices.delete(voiceId);
  }

  stopAll() {
    for (const id of Array.from(this.voices.keys())) this.stopSustain(id, true);
  }

  dispose() {
    this.stopAll();
    try {
      this.vibrato.stop();
    } catch {}
    try {
      void this.ctx.close();
    } catch {}
  }
}

type Spark = {
  angle: number;
  speed: number;
  radius: number;
  drift: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
};

type BowlInstance = {
  noteIdx: number;
  cx: number;
  cy: number;
  radius: number;
  innerRim: number;
  outerRim: number;
  sustainTarget: number;
  sustainCurrent: number;
  strikePulse: number;
  rimHighlight: number;
  rimAngle: number;
  singing: boolean;
  sparks: Spark[];
};

function makeBowl(noteIdx: number): BowlInstance {
  return {
    noteIdx,
    cx: 0,
    cy: 0,
    radius: 0,
    innerRim: 0,
    outerRim: 0,
    sustainTarget: 0,
    sustainCurrent: 0,
    strikePulse: 0,
    rimHighlight: 0,
    rimAngle: Math.random() * Math.PI * 2,
    singing: false,
    sparks: []
  };
}

function layoutBowls(bowls: BowlInstance[], w: number, h: number, isPortrait: boolean) {
  const n = bowls.length;
  if (n === 1) {
    const r = Math.min(w, h) * 0.46;
    bowls[0].cx = w / 2;
    bowls[0].cy = h / 2;
    bowls[0].radius = r;
  } else if (n === 2) {
    if (isPortrait) {
      const r = Math.min(w * 0.42, h * 0.22);
      bowls[0].cx = w / 2;
      bowls[0].cy = h * 0.27;
      bowls[0].radius = r;
      bowls[1].cx = w / 2;
      bowls[1].cy = h * 0.73;
      bowls[1].radius = r;
    } else {
      const r = Math.min(w * 0.22, h * 0.42);
      bowls[0].cx = w * 0.27;
      bowls[0].cy = h / 2;
      bowls[0].radius = r;
      bowls[1].cx = w * 0.73;
      bowls[1].cy = h / 2;
      bowls[1].radius = r;
    }
  } else if (n === 4) {
    const r = Math.min(w * 0.22, h * 0.22);
    bowls[0].cx = w * 0.27;
    bowls[0].cy = h * 0.27;
    bowls[0].radius = r;
    bowls[1].cx = w * 0.73;
    bowls[1].cy = h * 0.27;
    bowls[1].radius = r;
    bowls[2].cx = w * 0.27;
    bowls[2].cy = h * 0.73;
    bowls[2].radius = r;
    bowls[3].cx = w * 0.73;
    bowls[3].cy = h * 0.73;
    bowls[3].radius = r;
  }
  for (const b of bowls) {
    b.innerRim = b.radius * 0.55;
    b.outerRim = b.radius * 1.0;
  }
}

function bowlAt(x: number, y: number, bowls: BowlInstance[]): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < bowls.length; i++) {
    const b = bowls[i];
    const d = Math.hypot(x - b.cx, y - b.cy);
    if (d <= b.outerRim * 1.18 && d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function drawNoteLetter(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
  shadow?: string
) {
  ctx.save();
  ctx.font = `${size}px Georgia, "DM Serif Display", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = size * 0.5;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  b: BowlInstance,
  hue: number,
  multi: boolean
) {
  if (!multi) return;
  ctx.save();
  ctx.strokeStyle = `hsla(${hue}, 90%, 78%, 0.75)`;
  ctx.shadowColor = `hsla(${hue}, 90%, 78%, 0.85)`;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, b.radius * 1.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  hue: number,
  alpha: number
) {
  ctx.save();
  ctx.translate(x, y);
  const inner = size * 0.35;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? size : inner;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.shadowColor = `hsla(${hue}, 95%, 80%, ${alpha})`;
  ctx.shadowBlur = size * 3;
  ctx.fillStyle = `hsla(${hue}, 95%, 85%, ${alpha})`;
  ctx.fill();
  ctx.restore();
}

type RenderInput = {
  bowls: BowlInstance[];
  focusedIdx: number;
  timeAcc: number;
  w: number;
  h: number;
  dt: number;
  multi: boolean;
};

function renderZen(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { bowls, focusedIdx, w, h, dt, multi } = input;
  const focused = bowls[focusedIdx] ?? bowls[0];
  const focNote = NOTES[focused.noteIdx];
  const [fr, fg, fb] = focNote.glow;
  const live = 0.25 + focused.sustainCurrent * 0.55 + focused.strikePulse * 0.6;

  const back = ctx.createRadialGradient(focused.cx, focused.cy, 0, focused.cx, focused.cy, Math.max(w, h) * 0.7);
  back.addColorStop(0, `rgba(${fr},${fg},${fb},${0.08 + live * 0.18})`);
  back.addColorStop(0.45, `rgba(${fr},${fg},${fb},${0.02 + live * 0.05})`);
  back.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < bowls.length; i++) {
    const b = bowls[i];
    const note = NOTES[b.noteIdx];
    const [gr, gg, gb] = note.glow;
    const r = b.radius;
    const pulse = r * (1 + b.strikePulse * 0.035 + b.sustainCurrent * 0.012);

    const halo = ctx.createRadialGradient(b.cx, b.cy, r * 0.6, b.cx, b.cy, r * 1.8);
    halo.addColorStop(0, `rgba(${gr},${gg},${gb},${0.18 + (b.sustainCurrent * 0.5 + b.strikePulse * 0.6) * 0.35})`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(b.cx - r * 0.25, b.cy - r * 0.3, r * 0.1, b.cx, b.cy, pulse);
    body.addColorStop(0, `hsl(${note.hue}, 35%, 22%)`);
    body.addColorStop(0.6, `hsl(${note.hue}, 40%, 12%)`);
    body.addColorStop(1, `hsl(${note.hue}, 50%, 6%)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, pulse, 0, Math.PI * 2);
    ctx.fill();

    const well = ctx.createRadialGradient(b.cx + r * 0.15, b.cy + r * 0.2, r * 0.05, b.cx, b.cy, r * 0.78);
    well.addColorStop(0, `hsl(${note.hue}, 45%, 16%)`);
    well.addColorStop(0.7, 'rgba(8, 9, 14, 0.92)');
    well.addColorStop(1, 'rgba(4, 5, 9, 1)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = r * 0.07;
    const rimGrad = ctx.createLinearGradient(b.cx - r, b.cy - r, b.cx + r, b.cy + r);
    rimGrad.addColorStop(0, `hsla(${note.hue}, 55%, 60%, 0.65)`);
    rimGrad.addColorStop(0.5, `hsla(${note.hue}, 75%, 78%, 0.95)`);
    rimGrad.addColorStop(1, `hsla(${note.hue}, 55%, 45%, 0.65)`);
    ctx.strokeStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();

    if (b.rimHighlight > 0.001 || b.sustainCurrent > 0.001) {
      ctx.save();
      ctx.lineWidth = r * 0.04;
      ctx.strokeStyle = `rgba(${gr},${gg},${gb},${Math.min(1, b.rimHighlight + b.sustainCurrent * 0.7)})`;
      ctx.shadowColor = `rgba(${gr},${gg},${gb},0.9)`;
      ctx.shadowBlur = 22 + b.sustainCurrent * 40;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r * 0.88, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (b.strikePulse > 0) {
      ctx.save();
      const t = 1 - b.strikePulse;
      ctx.strokeStyle = `rgba(${gr},${gg},${gb},${b.strikePulse * 0.45})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r * 0.35 + r * 0.45 * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r * 0.18 + r * 0.5 * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const spawn = Math.floor(b.sustainCurrent * 4 + b.strikePulse * 6);
    for (let k = 0; k < spawn; k++) {
      b.sparks.push({
        angle: b.rimAngle + (Math.random() - 0.5) * 0.6,
        speed: 0.4 + Math.random() * 1.2,
        radius: r * 0.88 + (Math.random() - 0.5) * r * 0.06,
        drift: 0.08,
        life: 0,
        maxLife: 0.9 + Math.random() * 1.2,
        hue: note.hue,
        size: 1.6 + Math.random() * 1.2
      });
    }
    for (let k = b.sparks.length - 1; k >= 0; k--) {
      const sp = b.sparks[k];
      sp.life += dt;
      sp.angle += sp.speed * dt;
      sp.radius += dt * r * sp.drift;
      if (sp.life >= sp.maxLife) {
        b.sparks.splice(k, 1);
        continue;
      }
      const a = 1 - sp.life / sp.maxLife;
      const x = b.cx + Math.cos(sp.angle) * sp.radius;
      const y = b.cy + Math.sin(sp.angle) * sp.radius;
      ctx.fillStyle = `rgba(${gr},${gg},${gb},${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(x, y, sp.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    if (b.sparks.length > 300) b.sparks.splice(0, b.sparks.length - 300);

    ctx.fillStyle = `rgba(${gr},${gg},${gb},${0.18 + b.strikePulse * 0.6})`;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.05, 0, Math.PI * 2);
    ctx.fill();

    drawNoteLetter(
      ctx,
      note.note,
      b.cx,
      b.cy + r * 0.4,
      r * 0.22,
      `rgba(${gr},${gg},${gb},${0.55 + b.sustainCurrent * 0.4})`
    );
    drawFocusRing(ctx, b, note.hue, multi && i === focusedIdx);
  }
}

function renderPsychedelic(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { bowls, focusedIdx, timeAcc: t, w, h, dt, multi } = input;
  const focused = bowls[focusedIdx] ?? bowls[0];
  const focNote = NOTES[focused.noteIdx];
  const live = 0.3 + focused.sustainCurrent * 0.65 + focused.strikePulse * 0.8;

  const back = ctx.createRadialGradient(focused.cx, focused.cy, 0, focused.cx, focused.cy, Math.max(w, h) * 0.9);
  for (let i = 0; i <= 5; i++) {
    const hue = (focNote.hue + i * 60 + t * 35) % 360;
    back.addColorStop(i / 5, `hsla(${hue}, 80%, 50%, ${0.05 + live * 0.07})`);
  }
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < bowls.length; i++) {
    const b = bowls[i];
    const note = NOTES[b.noteIdx];
    const r = b.radius;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 6; k > 0; k--) {
      const hue = (note.hue + t * 70 + k * 50) % 360;
      const ringR = r * (1.0 + k * 0.18);
      ctx.fillStyle = `hsla(${hue}, 85%, 55%, ${0.04 + (b.sustainCurrent + b.strikePulse) * 0.05})`;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, ringR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.rotate(t * 0.45);
    ctx.globalCompositeOperation = 'lighter';
    const petals = 14;
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * Math.PI * 2;
      const hue = (note.hue + k * (360 / petals) + t * 90) % 360;
      const grad = ctx.createRadialGradient(0, 0, r * 0.08, 0, 0, r * 1.05);
      grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.22)`);
      grad.addColorStop(1, `hsla(${hue}, 80%, 30%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 1.05, a - Math.PI / petals, a + Math.PI / petals);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const wellHue = (note.hue + t * 110) % 360;
    const well = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r * 0.78);
    well.addColorStop(0, `hsla(${wellHue}, 70%, 16%, 0.92)`);
    well.addColorStop(0.6, `hsla(${(wellHue + 70) % 360}, 70%, 8%, 0.95)`);
    well.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = r * 0.05;
    const arcs = 9;
    for (let k = 0; k < arcs; k++) {
      const a0 = (k / arcs) * Math.PI * 2 + t * 0.55;
      const a1 = a0 + Math.PI * 0.22;
      const hue = (note.hue + k * 40 + t * 140) % 360;
      ctx.strokeStyle = `hsla(${hue}, 95%, 65%, ${0.7 + b.sustainCurrent * 0.3})`;
      ctx.shadowColor = `hsla(${hue}, 95%, 65%, 0.95)`;
      ctx.shadowBlur = 18 + b.sustainCurrent * 30;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r * 0.88, a0, a1);
      ctx.stroke();
    }
    ctx.restore();

    if (b.strikePulse > 0) {
      const tt = 1 - b.strikePulse;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 5; k++) {
        const hue = (note.hue + k * 72 + t * 220) % 360;
        ctx.strokeStyle = `hsla(${hue}, 95%, 60%, ${b.strikePulse * 0.55})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, r * (0.1 + 0.15 * k) + r * 0.6 * tt, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    const spawn = Math.floor(b.sustainCurrent * 7 + b.strikePulse * 12);
    for (let k = 0; k < spawn; k++) {
      b.sparks.push({
        angle: Math.random() * Math.PI * 2,
        speed: -1.4 + Math.random() * 2.8,
        radius: r * 0.88 + (Math.random() - 0.5) * r * 0.12,
        drift: 0.05 * (Math.random() < 0.5 ? -1 : 1),
        life: 0,
        maxLife: 1.2 + Math.random() * 1.6,
        hue: (note.hue + Math.random() * 360) % 360,
        size: 1.6 + Math.random() * 1.8
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = b.sparks.length - 1; k >= 0; k--) {
      const sp = b.sparks[k];
      sp.life += dt;
      sp.angle += sp.speed * dt;
      sp.radius += dt * r * sp.drift;
      if (sp.life >= sp.maxLife || sp.radius < r * 0.2 || sp.radius > r * 1.6) {
        b.sparks.splice(k, 1);
        continue;
      }
      const a = 1 - sp.life / sp.maxLife;
      const x = b.cx + Math.cos(sp.angle) * sp.radius;
      const y = b.cy + Math.sin(sp.angle) * sp.radius;
      const hue = (sp.hue + t * 200) % 360;
      ctx.fillStyle = `hsla(${hue}, 95%, 70%, ${a * 0.95})`;
      ctx.beginPath();
      ctx.arc(x, y, sp.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (b.sparks.length > 400) b.sparks.splice(0, b.sparks.length - 400);

    ctx.fillStyle = `hsla(${(note.hue + t * 220) % 360}, 95%, 72%, ${0.3 + b.strikePulse * 0.7})`;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

    drawNoteLetter(
      ctx,
      note.note,
      b.cx,
      b.cy + r * 0.42,
      r * 0.22,
      `hsla(${(note.hue + t * 140) % 360}, 95%, 80%, 0.8)`,
      `hsla(${(note.hue + t * 140) % 360}, 95%, 70%, 0.9)`
    );
    drawFocusRing(ctx, b, (note.hue + t * 90) % 360, multi && i === focusedIdx);
  }
}

function renderTechno(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { bowls, focusedIdx, timeAcc: t, w, h, dt, multi } = input;
  const focused = bowls[focusedIdx] ?? bowls[0];
  const focGlow = NOTES[focused.noteIdx].glow;
  const live = 0.2 + focused.sustainCurrent * 0.7 + focused.strikePulse * 0.85;

  ctx.fillStyle = 'rgba(4, 6, 10, 0.95)';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = `rgba(${focGlow[0]}, ${focGlow[1]}, ${focGlow[2]}, ${0.06 + live * 0.06})`;
  ctx.lineWidth = 1;
  const grid = 36;
  ctx.beginPath();
  for (let x = grid; x < w; x += grid) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = grid; y < h; y += grid) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < bowls.length; i++) {
    const b = bowls[i];
    const note = NOTES[b.noteIdx];
    const [gr, gg, gb] = note.glow;
    const r = b.radius;

    ctx.strokeStyle = `rgba(${gr},${gg},${gb},${0.1 + (b.sustainCurrent + b.strikePulse) * 0.2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.cx - r * 1.4, b.cy);
    ctx.lineTo(b.cx + r * 1.4, b.cy);
    ctx.moveTo(b.cx, b.cy - r * 1.4);
    ctx.lineTo(b.cx, b.cy + r * 1.4);
    ctx.stroke();

    const haloGrad = ctx.createRadialGradient(b.cx, b.cy, r * 0.7, b.cx, b.cy, r * 1.7);
    haloGrad.addColorStop(0, `rgba(${gr},${gg},${gb},${0.18 + (b.sustainCurrent + b.strikePulse) * 0.35})`);
    haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 1.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `hsl(${note.hue}, 28%, 6%)`;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(2, 4, 8, 1)';
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    const segments = 32;
    const segWidth = (Math.PI * 2) / segments;
    for (let k = 0; k < segments; k++) {
      const a = k * segWidth + b.rimAngle * 0.6;
      const phase = (k / segments + t * 0.35) % 1;
      const wave = Math.max(0, Math.sin(phase * Math.PI * 2));
      const intensity = 0.18 + wave * (0.35 + b.sustainCurrent + b.strikePulse);
      ctx.strokeStyle = `rgba(${gr},${gg},${gb},${Math.min(1, intensity)})`;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r * 0.88, a, a + segWidth * 0.7);
      ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = `rgba(${gr},${gg},${gb},0.9)`;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = `rgba(${gr},${gg},${gb},1)`;
    ctx.shadowBlur = 12 + b.sustainCurrent * 28;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (b.strikePulse > 0) {
      const tt = 1 - b.strikePulse;
      for (let k = 0; k < 3; k++) {
        const sz = r * (0.35 + 1.05 * tt + k * 0.18);
        ctx.strokeStyle = `rgba(${gr},${gg},${gb},${b.strikePulse * 0.45 * (1 - k * 0.3)})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.cx - sz, b.cy - sz, sz * 2, sz * 2);
      }
    }

    const spawn = Math.floor(b.sustainCurrent * 5 + b.strikePulse * 8);
    for (let k = 0; k < spawn; k++) {
      const seg = Math.floor(Math.random() * segments);
      b.sparks.push({
        angle: seg * segWidth + b.rimAngle * 0.6,
        speed: 0.6 + Math.random() * 0.9,
        radius: r * 0.88,
        drift: 0,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.8,
        hue: note.hue,
        size: 4
      });
    }
    for (let k = b.sparks.length - 1; k >= 0; k--) {
      const sp = b.sparks[k];
      sp.life += dt;
      sp.angle += sp.speed * dt;
      if (sp.life >= sp.maxLife) {
        b.sparks.splice(k, 1);
        continue;
      }
      const a = 1 - sp.life / sp.maxLife;
      const x = b.cx + Math.cos(sp.angle) * sp.radius;
      const y = b.cy + Math.sin(sp.angle) * sp.radius;
      ctx.fillStyle = `rgba(${gr},${gg},${gb},${a})`;
      ctx.fillRect(x - 2, y - 2, sp.size, sp.size);
    }
    if (b.sparks.length > 220) b.sparks.splice(0, b.sparks.length - 220);

    ctx.fillStyle = `rgba(${gr},${gg},${gb},${0.3 + b.strikePulse * 0.7})`;
    ctx.fillRect(b.cx - 3, b.cy - 3, 6, 6);

    drawNoteLetter(ctx, note.note, b.cx, b.cy + r * 0.42, r * 0.22, `rgba(${gr},${gg},${gb},0.85)`);
    drawFocusRing(ctx, b, note.hue, multi && i === focusedIdx);
  }
}

function renderFairy(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { bowls, focusedIdx, timeAcc: t, w, h, dt, multi } = input;
  const focused = bowls[focusedIdx] ?? bowls[0];
  const focNote = NOTES[focused.noteIdx];
  const live = 0.35 + focused.sustainCurrent * 0.7 + focused.strikePulse * 0.85;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 8, 22, 1)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const pastels = [320, 280, 200, 160, 50, 20];
  for (let i = 0; i < pastels.length; i++) {
    const ang = t * 0.15 + (i / pastels.length) * Math.PI * 2;
    const px = w / 2 + Math.cos(ang) * Math.max(w, h) * 0.22;
    const py = h / 2 + Math.sin(ang) * Math.max(w, h) * 0.22;
    const hue = (pastels[i] + focNote.hue * 0.15 + t * 12) % 360;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, Math.max(w, h) * 0.55);
    grad.addColorStop(0, `hsla(${hue}, 95%, 75%, ${0.08 + live * 0.07})`);
    grad.addColorStop(0.5, `hsla(${hue}, 95%, 60%, ${0.03 + live * 0.04})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();

  const drift = Math.sin(t * 0.5) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const seed = i * 12.9898;
    const px = ((Math.sin(seed) * 0.5 + 0.5) * w + t * (10 + (i % 5) * 3)) % w;
    const py = ((Math.cos(seed * 1.3) * 0.5 + 0.5) * h + drift * 4) % h;
    const hue = (focNote.hue + i * 25 + t * 35) % 360;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (1 + i * 0.13) + i));
    drawStar(ctx, px, py, 1.4 + tw * 1.4, hue, tw * 0.6);
  }
  ctx.restore();

  for (let i = 0; i < bowls.length; i++) {
    const b = bowls[i];
    const note = NOTES[b.noteIdx];
    const r = b.radius;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 6; k > 0; k--) {
      const hue = (note.hue + k * 30 + t * 25) % 360;
      const ringR = r * (1.0 + k * 0.16);
      const grad = ctx.createRadialGradient(b.cx, b.cy, ringR * 0.7, b.cx, b.cy, ringR);
      grad.addColorStop(0, `hsla(${hue}, 90%, 75%, ${0.05 + (b.sustainCurrent + b.strikePulse) * 0.05})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, ringR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const body = ctx.createRadialGradient(
      b.cx - r * 0.2,
      b.cy - r * 0.3,
      r * 0.1,
      b.cx,
      b.cy,
      r * (1 + b.strikePulse * 0.04)
    );
    body.addColorStop(0, `hsla(${(note.hue + 20) % 360}, 80%, 60%, 0.95)`);
    body.addColorStop(0.45, `hsla(${note.hue}, 70%, 40%, 0.95)`);
    body.addColorStop(0.85, `hsla(${(note.hue + 320) % 360}, 60%, 22%, 0.95)`);
    body.addColorStop(1, `hsla(${note.hue}, 60%, 14%, 1)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * (1 + b.strikePulse * 0.04), 0, Math.PI * 2);
    ctx.fill();

    const wellHue = (note.hue + t * 30) % 360;
    const well = ctx.createRadialGradient(b.cx, b.cy + r * 0.1, 0, b.cx, b.cy, r * 0.78);
    well.addColorStop(0, `hsla(${wellHue}, 60%, 22%, 0.95)`);
    well.addColorStop(0.55, `hsla(${(wellHue + 50) % 360}, 70%, 12%, 0.95)`);
    well.addColorStop(1, `rgba(8, 6, 16, 1)`);
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    for (let k = 0; k < 5; k++) {
      const dustA = t * (0.4 + k * 0.2) + k * 1.3;
      const dustR = r * (0.2 + 0.35 * Math.abs(Math.sin(t * 0.6 + k * 2)));
      const dx = b.cx + Math.cos(dustA) * dustR;
      const dy = b.cy + Math.sin(dustA) * dustR * 0.7;
      const hue = (note.hue + k * 50 + t * 60) % 360;
      ctx.fillStyle = `hsla(${hue}, 95%, 80%, 0.25)`;
      ctx.shadowColor = `hsla(${hue}, 95%, 80%, 0.6)`;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(dx, dy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.lineWidth = r * 0.06;
    const rimGrad = ctx.createLinearGradient(b.cx - r, b.cy - r, b.cx + r, b.cy + r);
    rimGrad.addColorStop(0, `hsla(${(note.hue + 30) % 360}, 95%, 80%, 0.85)`);
    rimGrad.addColorStop(0.5, `hsla(${(note.hue + 160) % 360}, 95%, 85%, 0.95)`);
    rimGrad.addColorStop(1, `hsla(${(note.hue + 280) % 360}, 95%, 75%, 0.85)`);
    ctx.strokeStyle = rimGrad;
    ctx.shadowColor = `hsla(${note.hue}, 95%, 75%, ${0.8 + b.sustainCurrent * 0.2})`;
    ctx.shadowBlur = 16 + b.sustainCurrent * 30 + b.strikePulse * 20;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const rimTwinkles = 12;
    for (let k = 0; k < rimTwinkles; k++) {
      const a = (k / rimTwinkles) * Math.PI * 2 + b.rimAngle * 0.5;
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + k * 1.7);
      const hue = (note.hue + k * 30 + t * 60) % 360;
      const x = b.cx + Math.cos(a) * r * 0.88;
      const y = b.cy + Math.sin(a) * r * 0.88;
      drawStar(ctx, x, y, 1.6 + tw * 2.2 + b.sustainCurrent * 2.2, hue, 0.45 + tw * 0.45);
    }

    if (b.strikePulse > 0) {
      const tt = 1 - b.strikePulse;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 4; k++) {
        const hue = (note.hue + k * 80 + t * 200) % 360;
        ctx.strokeStyle = `hsla(${hue}, 95%, 75%, ${b.strikePulse * 0.55})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, r * (0.12 + 0.18 * k) + r * 0.6 * tt, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    const spawn = Math.floor(b.sustainCurrent * 6 + b.strikePulse * 12);
    for (let k = 0; k < spawn; k++) {
      const off = (Math.random() - 0.5) * 0.7;
      b.sparks.push({
        angle: b.rimAngle + off,
        speed: 0.4 + Math.random() * 1.2,
        radius: r * 0.88 + (Math.random() - 0.5) * r * 0.08,
        drift: 0.05 + Math.random() * 0.08,
        life: 0,
        maxLife: 1.3 + Math.random() * 1.8,
        hue: (note.hue + Math.random() * 160 - 80 + 360) % 360,
        size: 2 + Math.random() * 2.6
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = b.sparks.length - 1; k >= 0; k--) {
      const sp = b.sparks[k];
      sp.life += dt;
      sp.angle += sp.speed * dt;
      sp.radius += dt * r * sp.drift;
      if (sp.life >= sp.maxLife) {
        b.sparks.splice(k, 1);
        continue;
      }
      const a = 1 - sp.life / sp.maxLife;
      const x = b.cx + Math.cos(sp.angle) * sp.radius;
      const y = b.cy + Math.sin(sp.angle) * sp.radius - (1 - a) * r * 0.05;
      const twinkle = 0.6 + 0.4 * Math.sin(sp.life * 12 + sp.angle * 4);
      drawStar(ctx, x, y, sp.size * a * twinkle, sp.hue, a * 0.85);
    }
    ctx.restore();
    if (b.sparks.length > 420) b.sparks.splice(0, b.sparks.length - 420);

    ctx.save();
    ctx.shadowColor = `hsla(${note.hue}, 95%, 80%, 0.9)`;
    ctx.shadowBlur = 14 + b.strikePulse * 30;
    ctx.fillStyle = `hsla(${note.hue}, 95%, 88%, ${0.5 + b.strikePulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r * 0.06 + b.strikePulse * r * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawNoteLetter(
      ctx,
      note.note,
      b.cx,
      b.cy + r * 0.42,
      r * 0.22,
      `hsla(${note.hue}, 95%, 88%, 0.92)`,
      `hsla(${note.hue}, 95%, 75%, 0.9)`
    );
    drawFocusRing(ctx, b, (note.hue + 40) % 360, multi && i === focusedIdx);
  }
}

const RENDERERS: Record<Mode, (ctx: CanvasRenderingContext2D, input: RenderInput) => void> = {
  fairy: renderFairy,
  zen: renderZen,
  psychedelic: renderPsychedelic,
  techno: renderTechno
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BowlEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef<{
    bowls: BowlInstance[];
    pointerTracks: Map<number, { bowlIdx: number; lastAngle: number; lastTime: number }>;
    focusedIdx: number;
    timeAcc: number;
    mode: Mode;
    canvasW: number;
    canvasH: number;
    isPortrait: boolean;
  }>({
    bowls: [makeBowl(DEFAULT_NOTES_BY_COUNT[1][0])],
    pointerTracks: new Map(),
    focusedIdx: 0,
    timeAcc: 0,
    mode: 'fairy',
    canvasW: 0,
    canvasH: 0,
    isPortrait: false
  });

  const [count, setCount] = useState<BowlCount>(1);
  const [notes, setNotes] = useState<number[]>([...DEFAULT_NOTES_BY_COUNT[1]]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('fairy');
  const [volume, setVolume] = useState(0.7);
  const [reverb, setReverb] = useState(0.5);
  const [railSide, setRailSide] = useState<'left' | 'right'>('right');
  const [isLandscape, setIsLandscape] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const focusedNote = NOTES[notes[focusedIdx] ?? 0];

  const ensureEngine = useCallback(() => {
    if (!engineRef.current) {
      const engine = new BowlEngine();
      engine.setMasterVolume(volume);
      engine.setReverbMix(reverb);
      const preset = MODE_AUDIO[mode];
      engine.setVibrato(preset.vibratoRate, preset.vibratoDepth);
      engineRef.current = engine;
      setAudioReady(true);
    }
    engineRef.current.resume();
    return engineRef.current;
  }, [volume, reverb, mode]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setMasterVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setReverbMix(reverb);
  }, [reverb]);

  useEffect(() => {
    stateRef.current.mode = mode;
    document.documentElement.dataset.mode = mode;
    for (const b of stateRef.current.bowls) b.sparks.length = 0;
    const preset = MODE_AUDIO[mode];
    if (engineRef.current) engineRef.current.setVibrato(preset.vibratoRate, preset.vibratoDepth);
  }, [mode]);

  useEffect(() => {
    const ref = stateRef.current;
    const engine = engineRef.current;
    while (ref.bowls.length > count) {
      const removedIdx = ref.bowls.length - 1;
      engine?.stopSustain(removedIdx, true);
      ref.bowls.pop();
    }
    while (ref.bowls.length < count) {
      const i = ref.bowls.length;
      const noteIdx = notes[i] ?? DEFAULT_NOTES_BY_COUNT[count][i] ?? 0;
      ref.bowls.push(makeBowl(noteIdx));
    }
    setNotes((prev) => {
      const next = [...prev];
      next.length = count;
      for (let i = 0; i < count; i++) {
        if (next[i] === undefined) next[i] = DEFAULT_NOTES_BY_COUNT[count][i] ?? 0;
      }
      return next;
    });
    if (focusedIdx >= count) setFocusedIdx(count - 1);
    if (canvasRef.current && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      stateRef.current.isPortrait = rect.height >= rect.width;
      layoutBowls(ref.bowls, rect.width, rect.height, stateRef.current.isPortrait);
    }
  }, [count, focusedIdx, notes]);

  useEffect(() => {
    const ref = stateRef.current;
    for (let i = 0; i < ref.bowls.length; i++) {
      const ni = notes[i];
      if (ni == null) continue;
      if (ref.bowls[i].noteIdx !== ni) {
        ref.bowls[i].noteIdx = ni;
        if (ref.bowls[i].singing && engineRef.current) {
          engineRef.current.startSustain(i, NOTES[ni].freq);
          engineRef.current.setSustainLevel(i, ref.bowls[i].sustainCurrent);
        }
      }
    }
  }, [notes]);

  useEffect(() => {
    stateRef.current.focusedIdx = focusedIdx;
    const note = NOTES[notes[focusedIdx] ?? 0];
    const root = document.documentElement;
    root.style.setProperty('--hue', String(note.hue));
    root.style.setProperty('--glow', `${note.glow[0]}, ${note.glow[1]}, ${note.glow[2]}`);
    root.style.setProperty('--accent', `hsl(${note.hue}, 70%, 65%)`);
  }, [focusedIdx, notes]);

  useLayoutEffect(() => {
    const update = () => setIsLandscape(window.innerWidth > window.innerHeight);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = stateRef.current;
    s.canvasW = rect.width;
    s.canvasH = rect.height;
    s.isPortrait = rect.height >= rect.width;
    layoutBowls(s.bowls, rect.width, rect.height, s.isPortrait);
  }, []);

  useLayoutEffect(() => {
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let prevTs = performance.now();
    const draw = (ts: number) => {
      const dt = Math.min(0.05, (ts - prevTs) / 1000);
      prevTs = ts;
      const s = stateRef.current;
      const w = s.canvasW;
      const h = s.canvasH;

      for (const b of s.bowls) {
        b.sustainCurrent += (b.sustainTarget - b.sustainCurrent) * Math.min(1, dt * 6);
        b.strikePulse = Math.max(0, b.strikePulse - dt * 0.9);
        b.rimHighlight = Math.max(0, b.rimHighlight - dt * 1.2);
        b.rimAngle += dt * (0.3 + b.sustainCurrent * 1.4);
      }
      s.timeAcc += dt;

      ctx.clearRect(0, 0, w, h);
      RENDERERS[s.mode](ctx, {
        bowls: s.bowls,
        focusedIdx: Math.min(s.focusedIdx, s.bowls.length - 1),
        timeAcc: s.timeAcc,
        w,
        h,
        dt,
        multi: s.bowls.length > 1
      });

      rafRef.current = window.requestAnimationFrame(draw);
    };
    rafRef.current = window.requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const selectNoteForFocused = useCallback(
    (noteIdx: number) => {
      setNotes((prev) => {
        const next = [...prev];
        next[focusedIdx] = noteIdx;
        return next;
      });
    },
    [focusedIdx]
  );

  const strikeBowl = useCallback(
    (idx: number) => {
      const engine = ensureEngine();
      const b = stateRef.current.bowls[idx];
      if (!b) return;
      engine.strike(NOTES[b.noteIdx].freq, 1);
      b.strikePulse = Math.min(1.4, b.strikePulse + 0.9);
      b.rimHighlight = Math.max(b.rimHighlight, 0.6);
    },
    [ensureEngine]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = stateRef.current;
      const idx = bowlAt(x, y, s.bowls);
      if (idx === -1) return;
      canvas.setPointerCapture(e.pointerId);
      const engine = ensureEngine();
      const b = s.bowls[idx];
      const dx = x - b.cx;
      const dy = y - b.cy;
      const r = Math.hypot(dx, dy);
      s.pointerTracks.set(e.pointerId, {
        bowlIdx: idx,
        lastAngle: Math.atan2(dy, dx),
        lastTime: performance.now()
      });
      if (idx !== s.focusedIdx) {
        s.focusedIdx = idx;
        setFocusedIdx(idx);
      }
      if (r < b.innerRim) {
        strikeBowl(idx);
      } else if (r <= b.outerRim * 1.18) {
        engine.startSustain(idx, NOTES[b.noteIdx].freq);
        b.singing = true;
        b.sustainTarget = 0;
        engine.setSustainLevel(idx, 0);
      }
    },
    [ensureEngine, strikeBowl]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const s = stateRef.current;
      const track = s.pointerTracks.get(e.pointerId);
      if (!track) return;
      const b = s.bowls[track.bowlIdx];
      if (!b) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - b.cx;
      const dy = y - b.cy;
      const r = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const now = performance.now();
      const dt = Math.max(0.001, (now - track.lastTime) / 1000);
      let da = angle - track.lastAngle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const angSpeed = Math.abs(da) / dt;
      const onRim = r > b.innerRim * 0.95 && r < b.outerRim * 1.18;
      if (onRim) {
        if (!b.singing) {
          ensureEngine().startSustain(track.bowlIdx, NOTES[b.noteIdx].freq);
          b.singing = true;
          b.sustainTarget = 0;
        }
        const target = Math.max(0, Math.min(1, (angSpeed - 0.3) / 5.5));
        b.sustainTarget = b.sustainTarget * 0.55 + target * 0.45;
        engineRef.current?.setSustainLevel(track.bowlIdx, b.sustainTarget);
        b.rimHighlight = Math.min(1, b.rimHighlight + b.sustainTarget * dt * 4);
      } else if (b.singing) {
        b.sustainTarget *= 0.6;
        engineRef.current?.setSustainLevel(track.bowlIdx, b.sustainTarget);
        if (b.sustainTarget < 0.02) {
          engineRef.current?.stopSustain(track.bowlIdx);
          b.singing = false;
          b.sustainTarget = 0;
        }
      }
      track.lastAngle = angle;
      track.lastTime = now;
    },
    [ensureEngine]
  );

  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const s = stateRef.current;
    const track = s.pointerTracks.get(e.pointerId);
    if (!track) return;
    const b = s.bowls[track.bowlIdx];
    if (b && b.singing) {
      engineRef.current?.stopSustain(track.bowlIdx);
      b.singing = false;
      b.sustainTarget = 0;
    }
    s.pointerTracks.delete(e.pointerId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        strikeBowl(stateRef.current.focusedIdx);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const n = stateRef.current.bowls.length;
        const dir = e.shiftKey ? -1 : 1;
        const next = (stateRef.current.focusedIdx + dir + n) % n;
        setFocusedIdx(next);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= NOTES.length) {
        selectNoteForFocused(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectNoteForFocused, strikeBowl]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const shellClass = useMemo(() => {
    const parts = ['shell'];
    parts.push(isLandscape ? 'landscape' : 'portrait');
    parts.push(`rail-${railSide}`);
    parts.push(`mode-${mode}`);
    return parts.join(' ');
  }, [isLandscape, railSide, mode]);

  return (
    <div className={shellClass}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Singing Bowl</span>
        </div>
        <div className="sliders">
          <label className="slider">
            <span>Volume</span>
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
          <label className="slider">
            <span>Reverb</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={reverb}
              onChange={(e) => setReverb(Number(e.target.value))}
              aria-label="Reverb"
            />
          </label>
        </div>
        <div className="header-actions">
          <div className="modes" role="radiogroup" aria-label="Visual mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === mode}
                className={`mode-btn${m.id === mode ? ' active' : ''}`}
                data-mode={m.id}
                onClick={() => setMode(m.id)}
                aria-label={m.label}
                title={m.label}
              >
                <span aria-hidden>{m.short}</span>
              </button>
            ))}
          </div>
          <div className="counts" role="radiogroup" aria-label="Bowl count">
            {COUNT_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === count}
                className={`count-btn${c === count ? ' active' : ''}`}
                onClick={() => setCount(c)}
                aria-label={`${c} bowl${c > 1 ? 's' : ''}`}
                title={`${c} bowl${c > 1 ? 's' : ''}`}
              >
                {c}
              </button>
            ))}
          </div>
          {isLandscape && (
            <button
              type="button"
              className="rail-toggle"
              onClick={() => setRailSide((s) => (s === 'left' ? 'right' : 'left'))}
              aria-label={`Move bowl picker to ${railSide === 'left' ? 'right' : 'left'}`}
            >
              <span aria-hidden>{railSide === 'left' ? '→' : '←'}</span>
            </button>
          )}
        </div>
      </header>

      <div className="stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="bowl-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerEnd}
        />
        <div className="stage-meta">
          <div className="focused-note">
            <span className="focused-letter">{focusedNote.note}</span>
            <span className="focused-freq">{focusedNote.freq.toFixed(2)} Hz</span>
            <span className="focused-label">{focusedNote.label}</span>
          </div>
          {!audioReady && <div className="hint">Tap or trace a rim to begin</div>}
        </div>
      </div>

      <nav className="rail" aria-label="Note selector">
        {NOTES.map((n, i) => (
          <button
            key={n.note + i}
            type="button"
            className={`note-btn${i === notes[focusedIdx] ? ' active' : ''}`}
            style={
              {
                '--btn-hue': n.hue,
                '--btn-glow': `${n.glow[0]}, ${n.glow[1]}, ${n.glow[2]}`
              } as React.CSSProperties
            }
            onClick={() => selectNoteForFocused(i)}
            aria-pressed={i === notes[focusedIdx]}
            aria-label={`${n.label}, ${n.note}, ${n.freq.toFixed(2)} hertz`}
          >
            <span className="note-btn-letter">{n.note}</span>
            <span className="note-btn-key">{i + 1}</span>
          </button>
        ))}
      </nav>

      <style jsx>{`
        .shell {
          display: grid;
          width: 100vw;
          height: 100dvh;
          min-height: 100vh;
          padding: clamp(8px, 1.6vmin, 18px);
          gap: clamp(8px, 1.4vmin, 16px);
          color: var(--t1);
        }
        .shell.portrait {
          grid-template-rows: auto 1fr auto;
          grid-template-areas:
            'header'
            'stage'
            'rail';
        }
        .shell.landscape.rail-right {
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 1fr;
          grid-template-areas:
            'header header'
            'stage  rail';
        }
        .shell.landscape.rail-left {
          grid-template-columns: auto 1fr;
          grid-template-rows: auto 1fr;
          grid-template-areas:
            'header header'
            'rail   stage';
        }
        .header {
          grid-area: header;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: clamp(10px, 2vmin, 28px);
          padding: clamp(6px, 1.4vmin, 14px) clamp(10px, 2vmin, 22px);
          background: rgba(20, 22, 32, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 18px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .brand-mark {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: radial-gradient(
            circle at 35% 30%,
            hsla(var(--hue), 95%, 82%, 1),
            hsla(var(--hue), 80%, 50%, 1) 55%,
            hsla(var(--hue), 70%, 22%, 1) 100%
          );
          box-shadow: 0 0 18px rgba(var(--glow), 0.6);
          transition: box-shadow 0.6s ease, background 0.6s ease;
          flex-shrink: 0;
        }
        .brand-name {
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(16px, 2.4vmin, 22px);
          letter-spacing: 0.02em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sliders {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(10px, 2vmin, 28px);
          min-width: 0;
        }
        .slider {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 10px;
          color: var(--t2);
          font-size: clamp(11px, 1.6vmin, 13px);
          min-width: 0;
        }
        .slider span {
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .modes,
        .counts {
          display: flex;
          gap: 3px;
          padding: 3px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 12px;
        }
        .mode-btn,
        .count-btn {
          width: clamp(26px, 4.4vmin, 34px);
          height: clamp(26px, 4.4vmin, 30px);
          border-radius: 9px;
          color: var(--t2);
          font-family: var(--sans), system-ui, sans-serif;
          font-size: clamp(10px, 1.5vmin, 12px);
          font-weight: 600;
          letter-spacing: 0.06em;
          display: grid;
          place-items: center;
          transition: background 0.25s ease, color 0.25s ease, box-shadow 0.3s ease,
            transform 0.2s ease;
        }
        .mode-btn:hover,
        .count-btn:hover {
          color: var(--t1);
          background: rgba(255, 255, 255, 0.06);
        }
        .mode-btn:active,
        .count-btn:active {
          transform: scale(0.94);
        }
        .mode-btn.active,
        .count-btn.active {
          color: var(--t1);
          background: linear-gradient(
            180deg,
            hsla(var(--hue), 70%, 35%, 0.55),
            hsla(var(--hue), 70%, 18%, 0.45)
          );
          box-shadow: 0 0 12px rgba(var(--glow), 0.45),
            inset 0 0 8px rgba(var(--glow), 0.25);
        }
        .mode-btn[data-mode='fairy'].active {
          background: linear-gradient(
            90deg,
            hsla(320, 95%, 65%, 0.6),
            hsla(220, 95%, 70%, 0.55),
            hsla(45, 95%, 70%, 0.55)
          );
          color: #fff;
          box-shadow: 0 0 16px hsla(320, 95%, 75%, 0.65);
        }
        .mode-btn[data-mode='psychedelic'].active {
          background: linear-gradient(
            90deg,
            hsla(310, 90%, 50%, 0.55),
            hsla(180, 90%, 50%, 0.55),
            hsla(50, 90%, 55%, 0.55)
          );
          color: #fff;
          box-shadow: 0 0 16px hsla(290, 90%, 65%, 0.55);
        }
        .mode-btn[data-mode='techno'].active {
          background: linear-gradient(180deg, #03161e, #02080d);
          color: #6ff4ff;
          box-shadow: 0 0 14px rgba(43, 247, 255, 0.55),
            inset 0 0 6px rgba(43, 247, 255, 0.35);
        }
        .rail-toggle {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: var(--t1);
          font-size: 16px;
          display: grid;
          place-items: center;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .rail-toggle:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .rail-toggle:active {
          transform: scale(0.96);
        }
        .stage {
          grid-area: stage;
          position: relative;
          min-width: 0;
          min-height: 0;
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: 22px;
        }
        .bowl-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          touch-action: none;
          display: block;
        }
        .stage-meta {
          position: absolute;
          left: 50%;
          bottom: clamp(8px, 1.6vmin, 18px);
          transform: translateX(-50%);
          z-index: 2;
          pointer-events: none;
          color: var(--t1);
          text-align: center;
          opacity: 0.85;
        }
        .focused-note {
          display: inline-flex;
          align-items: baseline;
          gap: 10px;
          padding: 4px 14px;
          border-radius: 999px;
          background: rgba(20, 22, 32, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .focused-letter {
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(16px, 2.6vmin, 22px);
        }
        .focused-freq {
          color: var(--t2);
          font-size: clamp(10px, 1.5vmin, 12px);
          letter-spacing: 0.16em;
        }
        .focused-label {
          color: var(--t2);
          font-size: clamp(10px, 1.5vmin, 12px);
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .hint {
          margin-top: 10px;
          font-size: clamp(11px, 1.6vmin, 13px);
          color: var(--t2);
          opacity: 0.75;
        }
        .rail {
          grid-area: rail;
          display: flex;
          gap: clamp(5px, 1vmin, 12px);
          padding: clamp(8px, 1.6vmin, 14px);
          background: rgba(20, 22, 32, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 18px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .shell.portrait .rail {
          flex-direction: row;
          justify-content: space-between;
          align-items: stretch;
        }
        .shell.landscape .rail {
          flex-direction: column;
          justify-content: center;
          align-items: stretch;
        }
        .note-btn {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: clamp(5px, 1.2vmin, 11px) clamp(3px, 0.9vmin, 10px);
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: linear-gradient(
            180deg,
            hsla(var(--btn-hue), 60%, 28%, 0.35),
            hsla(var(--btn-hue), 60%, 12%, 0.25)
          );
          color: var(--t1);
          transition: transform 0.18s ease, box-shadow 0.3s ease, background 0.3s ease,
            border-color 0.3s ease;
          min-height: 44px;
        }
        .shell.landscape .note-btn {
          min-width: 52px;
        }
        .note-btn:hover {
          border-color: rgba(255, 255, 255, 0.16);
          transform: translateY(-1px);
        }
        .note-btn.active {
          border-color: hsla(var(--btn-hue), 90%, 75%, 0.75);
          background: linear-gradient(
            180deg,
            hsla(var(--btn-hue), 80%, 40%, 0.6),
            hsla(var(--btn-hue), 80%, 20%, 0.5)
          );
          box-shadow: 0 0 22px rgba(var(--btn-glow), 0.5),
            inset 0 0 12px rgba(var(--btn-glow), 0.3);
        }
        .note-btn-letter {
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(14px, 2.4vmin, 20px);
          line-height: 1;
        }
        .note-btn-key {
          font-size: clamp(9px, 1.3vmin, 11px);
          letter-spacing: 0.16em;
          color: var(--t2);
        }
        @media (max-width: 520px) {
          .brand-name {
            display: none;
          }
          .slider span {
            display: none;
          }
          .sliders {
            gap: 12px;
          }
        }
      `}</style>
    </div>
  );
}
