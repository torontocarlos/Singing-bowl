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

type Bowl = {
  note: string;
  freq: number;
  hue: number;
  glow: [number, number, number];
  label: string;
};

const BOWLS: Bowl[] = [
  { note: 'C', freq: 130.81, hue: 355, glow: [220, 90, 110], label: 'Root' },
  { note: 'D', freq: 146.83, hue: 22, glow: [230, 140, 80], label: 'Sacral' },
  { note: 'E', freq: 164.81, hue: 48, glow: [230, 205, 100], label: 'Solar' },
  { note: 'F', freq: 174.61, hue: 138, glow: [120, 210, 150], label: 'Heart' },
  { note: 'G', freq: 196.0, hue: 200, glow: [120, 200, 230], label: 'Throat' },
  { note: 'A', freq: 220.0, hue: 250, glow: [150, 150, 230], label: 'Brow' },
  { note: 'B', freq: 246.94, hue: 290, glow: [210, 150, 230], label: 'Crown' }
];

const PARTIALS = [
  { ratio: 1, beat: 0.4, gain: 1.0, decay: 6.5 },
  { ratio: 2.76, beat: 1.1, gain: 0.55, decay: 4.5 },
  { ratio: 5.4, beat: 1.8, gain: 0.32, decay: 3.2 },
  { ratio: 8.93, beat: 2.6, gain: 0.17, decay: 2.2 },
  { ratio: 13.34, beat: 3.6, gain: 0.09, decay: 1.4 }
];

type Mode = 'zen' | 'psychedelic' | 'techno';

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'zen', label: 'Zen', short: 'Z' },
  { id: 'psychedelic', label: 'Psychedelic', short: 'P' },
  { id: 'techno', label: 'Techno', short: 'T' }
];

const MODE_AUDIO: Record<Mode, { vibratoRate: number; vibratoDepth: number }> = {
  zen: { vibratoRate: 5.2, vibratoDepth: 2.4 },
  psychedelic: { vibratoRate: 3.6, vibratoDepth: 5.5 },
  techno: { vibratoRate: 7.4, vibratoDepth: 1.0 }
};

class BowlEngine {
  ctx: AudioContext;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
  vibrato: OscillatorNode;
  vibratoGain: GainNode;
  sustainGain: GainNode | null = null;
  sustainOscs: OscillatorNode[] = [];
  reverbMix = 0.5;

  constructor() {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    this.vibrato.frequency.value = 5.2;
    this.vibratoGain = this.ctx.createGain();
    this.vibratoGain.gain.value = 2.4;
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
    this.reverbMix = v;
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

  startSustain(freq: number) {
    this.stopSustain(true);
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
    this.sustainGain = bus;
    this.sustainOscs = oscs;
  }

  setSustainLevel(v: number) {
    if (!this.sustainGain) return;
    const now = this.ctx.currentTime;
    this.sustainGain.gain.cancelScheduledValues(now);
    this.sustainGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), now + 0.06);
  }

  stopSustain(fast = false) {
    if (!this.sustainGain) return;
    const now = this.ctx.currentTime;
    const bus = this.sustainGain;
    const oscs = this.sustainOscs;
    const tail = fast ? 0.05 : 0.9;
    bus.gain.cancelScheduledValues(now);
    bus.gain.linearRampToValueAtTime(0, now + tail);
    window.setTimeout(() => {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {}
        try {
          o.disconnect();
        } catch {}
      }
      try {
        bus.disconnect();
      } catch {}
    }, (tail + 0.1) * 1000);
    this.sustainGain = null;
    this.sustainOscs = [];
  }

  dispose() {
    this.stopSustain(true);
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
  life: number;
  maxLife: number;
};

type Scene = {
  cx: number;
  cy: number;
  radius: number;
  innerRim: number;
  outerRim: number;
  pointerActive: boolean;
  lastAngle: number;
  lastTime: number;
  singing: boolean;
  sustainTarget: number;
  sustainCurrent: number;
  strikePulse: number;
  rimHighlight: number;
  rimAngle: number;
  timeAcc: number;
  hue: number;
  glow: [number, number, number];
  mode: Mode;
};

function drawZen(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  w: number,
  h: number,
  dt: number,
  sparks: Spark[]
) {
  const [gr, gg, gb] = s.glow;
  const liveGlow = 0.25 + s.sustainCurrent * 0.55 + s.strikePulse * 0.6;

  const back = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, Math.max(w, h) * 0.7);
  back.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${0.08 + liveGlow * 0.18})`);
  back.addColorStop(0.45, `rgba(${gr}, ${gg}, ${gb}, ${0.02 + liveGlow * 0.05})`);
  back.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, w, h);

  const r = s.radius;
  const pulse = r * (1 + s.strikePulse * 0.035 + s.sustainCurrent * 0.012);

  const halo = ctx.createRadialGradient(s.cx, s.cy, r * 0.6, s.cx, s.cy, r * 1.8);
  halo.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${0.18 + liveGlow * 0.35})`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(
    s.cx - r * 0.25,
    s.cy - r * 0.3,
    r * 0.1,
    s.cx,
    s.cy,
    pulse
  );
  body.addColorStop(0, `hsl(${s.hue}, 35%, 22%)`);
  body.addColorStop(0.6, `hsl(${s.hue}, 40%, 12%)`);
  body.addColorStop(1, `hsl(${s.hue}, 50%, 6%)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, pulse, 0, Math.PI * 2);
  ctx.fill();

  const well = ctx.createRadialGradient(
    s.cx + r * 0.15,
    s.cy + r * 0.2,
    r * 0.05,
    s.cx,
    s.cy,
    r * 0.78
  );
  well.addColorStop(0, `hsl(${s.hue}, 45%, 16%)`);
  well.addColorStop(0.7, 'rgba(8, 9, 14, 0.92)');
  well.addColorStop(1, 'rgba(4, 5, 9, 1)');
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.78, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = r * 0.07;
  const rimGrad = ctx.createLinearGradient(s.cx - r, s.cy - r, s.cx + r, s.cy + r);
  rimGrad.addColorStop(0, `hsla(${s.hue}, 55%, 60%, 0.65)`);
  rimGrad.addColorStop(0.5, `hsla(${s.hue}, 75%, 78%, 0.95)`);
  rimGrad.addColorStop(1, `hsla(${s.hue}, 55%, 45%, 0.65)`);
  ctx.strokeStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();

  if (s.rimHighlight > 0.001 || s.sustainCurrent > 0.001) {
    ctx.save();
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${Math.min(1, s.rimHighlight + s.sustainCurrent * 0.7)})`;
    ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, 0.9)`;
    ctx.shadowBlur = 22 + s.sustainCurrent * 40;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (s.strikePulse > 0) {
    ctx.save();
    const t = 1 - s.strikePulse;
    ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${s.strikePulse * 0.45})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.35 + r * 0.45 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.18 + r * 0.5 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const spawn = Math.floor(s.sustainCurrent * 4 + s.strikePulse * 6);
  for (let i = 0; i < spawn; i++) {
    sparks.push({
      angle: s.rimAngle + (Math.random() - 0.5) * 0.6,
      speed: 0.4 + Math.random() * 1.2,
      radius: r * 0.88 + (Math.random() - 0.5) * r * 0.06,
      life: 0,
      maxLife: 0.9 + Math.random() * 1.2
    });
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const sp = sparks[i];
    sp.life += dt;
    sp.angle += sp.speed * dt;
    sp.radius += dt * r * 0.08;
    if (sp.life >= sp.maxLife) {
      sparks.splice(i, 1);
      continue;
    }
    const a = 1 - sp.life / sp.maxLife;
    const x = s.cx + Math.cos(sp.angle) * sp.radius;
    const y = s.cy + Math.sin(sp.angle) * sp.radius;
    ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${a * 0.9})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 + a * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (sparks.length > 400) sparks.splice(0, sparks.length - 400);

  ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${0.18 + s.strikePulse * 0.6})`;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function drawPsychedelic(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  w: number,
  h: number,
  dt: number,
  sparks: Spark[]
) {
  const r = s.radius;
  const t = s.timeAcc;
  const live = 0.3 + s.sustainCurrent * 0.65 + s.strikePulse * 0.8;

  const back = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, Math.max(w, h) * 0.9);
  for (let i = 0; i <= 5; i++) {
    const hue = (s.hue + i * 60 + t * 35) % 360;
    back.addColorStop(i / 5, `hsla(${hue}, 80%, 50%, ${0.05 + live * 0.07})`);
  }
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 6; i > 0; i--) {
    const hue = (s.hue + t * 70 + i * 50) % 360;
    const ringR = r * (1.0 + i * 0.18);
    ctx.fillStyle = `hsla(${hue}, 85%, 55%, ${0.04 + live * 0.05})`;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, ringR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(s.cx, s.cy);
  ctx.rotate(t * 0.45);
  ctx.globalCompositeOperation = 'lighter';
  const petals = 14;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const hue = (s.hue + i * (360 / petals) + t * 90) % 360;
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

  const wellHue = (s.hue + t * 110) % 360;
  const well = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, r * 0.78);
  well.addColorStop(0, `hsla(${wellHue}, 70%, 16%, 0.92)`);
  well.addColorStop(0.6, `hsla(${(wellHue + 70) % 360}, 70%, 8%, 0.95)`);
  well.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.78, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = r * 0.05;
  const arcs = 9;
  for (let i = 0; i < arcs; i++) {
    const a0 = (i / arcs) * Math.PI * 2 + t * 0.55;
    const a1 = a0 + Math.PI * 0.22;
    const hue = (s.hue + i * 40 + t * 140) % 360;
    ctx.strokeStyle = `hsla(${hue}, 95%, 65%, ${0.7 + live * 0.3})`;
    ctx.shadowColor = `hsla(${hue}, 95%, 65%, 0.95)`;
    ctx.shadowBlur = 18 + s.sustainCurrent * 30;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.88, a0, a1);
    ctx.stroke();
  }
  ctx.restore();

  if (s.strikePulse > 0) {
    const tt = 1 - s.strikePulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const hue = (s.hue + i * 72 + t * 220) % 360;
      ctx.strokeStyle = `hsla(${hue}, 95%, 60%, ${s.strikePulse * 0.55})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, r * (0.1 + 0.15 * i) + r * 0.6 * tt, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  const spawn = Math.floor(s.sustainCurrent * 7 + s.strikePulse * 12);
  for (let i = 0; i < spawn; i++) {
    sparks.push({
      angle: Math.random() * Math.PI * 2,
      speed: -1.4 + Math.random() * 2.8,
      radius: r * 0.88 + (Math.random() - 0.5) * r * 0.12,
      life: 0,
      maxLife: 1.2 + Math.random() * 1.6
    });
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const sp = sparks[i];
    sp.life += dt;
    sp.angle += sp.speed * dt;
    sp.radius += dt * r * 0.05 * (sp.speed >= 0 ? 1 : -1);
    if (sp.life >= sp.maxLife || sp.radius < r * 0.2 || sp.radius > r * 1.6) {
      sparks.splice(i, 1);
      continue;
    }
    const a = 1 - sp.life / sp.maxLife;
    const x = s.cx + Math.cos(sp.angle) * sp.radius;
    const y = s.cy + Math.sin(sp.angle) * sp.radius;
    const hue = (s.hue + sp.angle * 70 + t * 220) % 360;
    ctx.fillStyle = `hsla(${hue}, 95%, 70%, ${a * 0.95})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 + a * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (sparks.length > 500) sparks.splice(0, sparks.length - 500);

  ctx.fillStyle = `hsla(${(s.hue + t * 220) % 360}, 95%, 72%, ${0.3 + s.strikePulse * 0.7})`;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawTechno(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  w: number,
  h: number,
  dt: number,
  sparks: Spark[]
) {
  const r = s.radius;
  const [gr, gg, gb] = s.glow;
  const t = s.timeAcc;
  const live = 0.2 + s.sustainCurrent * 0.7 + s.strikePulse * 0.85;

  ctx.fillStyle = 'rgba(4, 6, 10, 0.9)';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${0.06 + live * 0.06})`;
  ctx.lineWidth = 1;
  const grid = 36;
  const ox = s.cx % grid;
  const oy = s.cy % grid;
  ctx.beginPath();
  for (let x = ox; x < w; x += grid) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = oy; y < h; y += grid) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${0.1 + live * 0.12})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s.cx - r * 1.5, s.cy);
  ctx.lineTo(s.cx + r * 1.5, s.cy);
  ctx.moveTo(s.cx, s.cy - r * 1.5);
  ctx.lineTo(s.cx, s.cy + r * 1.5);
  ctx.stroke();

  const haloGrad = ctx.createRadialGradient(s.cx, s.cy, r * 0.7, s.cx, s.cy, r * 1.7);
  haloGrad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${0.18 + live * 0.4})`);
  haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `hsl(${s.hue}, 28%, 6%)`;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(2, 4, 8, 1)';
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.78, 0, Math.PI * 2);
  ctx.fill();

  const segments = 32;
  const segWidth = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a = i * segWidth + s.rimAngle * 0.6;
    const phase = (i / segments + t * 0.35) % 1;
    const wave = Math.max(0, Math.sin(phase * Math.PI * 2));
    const intensity = 0.18 + wave * (0.35 + s.sustainCurrent + s.strikePulse);
    ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${Math.min(1, intensity)})`;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.88, a, a + segWidth * 0.7);
    ctx.stroke();
  }

  ctx.save();
  ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, 0.9)`;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, 1)`;
  ctx.shadowBlur = 12 + s.sustainCurrent * 28;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (s.strikePulse > 0) {
    const tt = 1 - s.strikePulse;
    for (let i = 0; i < 3; i++) {
      const sz = r * (0.35 + 1.05 * tt + i * 0.18);
      ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${s.strikePulse * 0.45 * (1 - i * 0.3)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.cx - sz, s.cy - sz, sz * 2, sz * 2);
    }
  }

  const spawn = Math.floor(s.sustainCurrent * 5 + s.strikePulse * 8);
  for (let i = 0; i < spawn; i++) {
    const seg = Math.floor(Math.random() * segments);
    sparks.push({
      angle: seg * segWidth + s.rimAngle * 0.6,
      speed: 0.6 + Math.random() * 0.9,
      radius: r * 0.88,
      life: 0,
      maxLife: 0.55 + Math.random() * 0.8
    });
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const sp = sparks[i];
    sp.life += dt;
    sp.angle += sp.speed * dt;
    if (sp.life >= sp.maxLife) {
      sparks.splice(i, 1);
      continue;
    }
    const a = 1 - sp.life / sp.maxLife;
    const x = s.cx + Math.cos(sp.angle) * sp.radius;
    const y = s.cy + Math.sin(sp.angle) * sp.radius;
    ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${a})`;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  if (sparks.length > 300) sparks.splice(0, sparks.length - 300);

  ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${0.3 + s.strikePulse * 0.7})`;
  ctx.fillRect(s.cx - 3, s.cy - 3, 6, 6);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BowlEngine | null>(null);
  const sparksRef = useRef<Spark[]>([]);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef({
    cx: 0,
    cy: 0,
    radius: 0,
    innerRim: 0,
    outerRim: 0,
    pointerActive: false,
    lastAngle: 0,
    lastTime: 0,
    singing: false,
    sustainTarget: 0,
    sustainCurrent: 0,
    strikePulse: 0,
    rimHighlight: 0,
    rimAngle: 0,
    timeAcc: 0,
    hue: BOWLS[3].hue,
    glow: BOWLS[3].glow,
    mode: 'zen' as Mode
  });

  const [bowlIdx, setBowlIdx] = useState(3);
  const [volume, setVolume] = useState(0.7);
  const [reverb, setReverb] = useState(0.5);
  const [railSide, setRailSide] = useState<'left' | 'right'>('right');
  const [isLandscape, setIsLandscape] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [mode, setMode] = useState<Mode>('zen');

  const bowl = BOWLS[bowlIdx];

  const ensureEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new BowlEngine();
      engineRef.current.setMasterVolume(volume);
      engineRef.current.setReverbMix(reverb);
      setAudioReady(true);
    }
    engineRef.current.resume();
    return engineRef.current;
  }, [volume, reverb]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setMasterVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setReverbMix(reverb);
  }, [reverb]);

  useEffect(() => {
    stateRef.current.mode = mode;
    sparksRef.current.length = 0;
    const root = document.documentElement;
    root.dataset.mode = mode;
    const preset = MODE_AUDIO[mode];
    if (engineRef.current) engineRef.current.setVibrato(preset.vibratoRate, preset.vibratoDepth);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--hue', String(bowl.hue));
    root.style.setProperty('--glow', `${bowl.glow[0]}, ${bowl.glow[1]}, ${bowl.glow[2]}`);
    root.style.setProperty(
      '--accent',
      `hsl(${bowl.hue}, 70%, 65%)`
    );
    stateRef.current.hue = bowl.hue;
    stateRef.current.glow = bowl.glow;
  }, [bowl]);

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
    s.cx = rect.width / 2;
    s.cy = rect.height / 2;
    s.radius = Math.min(rect.width, rect.height) * 0.46;
    s.innerRim = s.radius * 0.55;
    s.outerRim = s.radius * 1.0;
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
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);

      s.sustainCurrent += (s.sustainTarget - s.sustainCurrent) * Math.min(1, dt * 6);
      s.strikePulse = Math.max(0, s.strikePulse - dt * 0.9);
      s.rimHighlight = Math.max(0, s.rimHighlight - dt * 1.2);
      s.rimAngle += dt * (0.3 + s.sustainCurrent * 1.4);
      s.timeAcc += dt;

      ctx.clearRect(0, 0, w, h);

      if (s.mode === 'psychedelic') {
        drawPsychedelic(ctx, s, w, h, dt, sparksRef.current);
      } else if (s.mode === 'techno') {
        drawTechno(ctx, s, w, h, dt, sparksRef.current);
      } else {
        drawZen(ctx, s, w, h, dt, sparksRef.current);
      }

      rafRef.current = window.requestAnimationFrame(draw);
    };
    rafRef.current = window.requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const selectBowl = useCallback(
    (idx: number) => {
      setBowlIdx(idx);
      const engine = engineRef.current;
      const s = stateRef.current;
      if (engine && s.singing) {
        engine.startSustain(BOWLS[idx].freq);
        engine.setSustainLevel(s.sustainCurrent);
      }
    },
    []
  );

  const strikeBowl = useCallback(
    (energy = 1) => {
      const engine = ensureEngine();
      engine.strike(bowl.freq, energy);
      stateRef.current.strikePulse = Math.min(1.4, stateRef.current.strikePulse + 0.9);
      stateRef.current.rimHighlight = Math.max(stateRef.current.rimHighlight, 0.6);
    },
    [bowl.freq, ensureEngine]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      const engine = ensureEngine();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = stateRef.current;
      const dx = x - s.cx;
      const dy = y - s.cy;
      const r = Math.hypot(dx, dy);
      s.pointerActive = true;
      s.lastTime = performance.now();
      s.lastAngle = Math.atan2(dy, dx);
      if (r < s.innerRim) {
        strikeBowl(1);
        return;
      }
      if (r <= s.outerRim) {
        engine.startSustain(bowl.freq);
        s.singing = true;
        s.sustainTarget = 0;
        engine.setSustainLevel(0);
      }
    },
    [bowl.freq, ensureEngine, strikeBowl]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const s = stateRef.current;
      if (!s.pointerActive) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - s.cx;
      const dy = y - s.cy;
      const r = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const now = performance.now();
      const dt = Math.max(0.001, (now - s.lastTime) / 1000);
      let da = angle - s.lastAngle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const angSpeed = Math.abs(da) / dt;

      const onRim = r > s.innerRim * 0.95 && r < s.outerRim * 1.1;
      if (onRim) {
        if (!s.singing) {
          ensureEngine().startSustain(bowl.freq);
          s.singing = true;
          s.sustainTarget = 0;
        }
        const target = Math.max(0, Math.min(1, (angSpeed - 0.3) / 5.5));
        s.sustainTarget = s.sustainTarget * 0.55 + target * 0.45;
        engineRef.current?.setSustainLevel(s.sustainTarget);
        s.rimHighlight = Math.min(1, s.rimHighlight + s.sustainTarget * dt * 4);
      } else if (s.singing) {
        s.sustainTarget *= 0.6;
        engineRef.current?.setSustainLevel(s.sustainTarget);
        if (s.sustainTarget < 0.02) {
          engineRef.current?.stopSustain();
          s.singing = false;
          s.sustainTarget = 0;
        }
      }

      s.lastAngle = angle;
      s.lastTime = now;
    },
    [bowl.freq, ensureEngine]
  );

  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const s = stateRef.current;
    s.pointerActive = false;
    if (s.singing) {
      engineRef.current?.stopSustain();
      s.singing = false;
      s.sustainTarget = 0;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        strikeBowl(1);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 7) {
        selectBowl(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectBowl, strikeBowl]);

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
    return parts.join(' ');
  }, [isLandscape, railSide]);

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
                <span className="mode-btn-short" aria-hidden>
                  {m.short}
                </span>
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
        <div className="bowl-meta">
          <div className="bowl-note">
            <span className="bowl-note-letter">{bowl.note}</span>
            <span className="bowl-note-freq">{bowl.freq.toFixed(2)} Hz</span>
          </div>
          <div className="bowl-label">{bowl.label}</div>
          {!audioReady && <div className="bowl-hint">Tap or trace the rim to begin</div>}
        </div>
      </div>

      <nav className="rail" aria-label="Bowl selector">
        {BOWLS.map((b, i) => (
          <button
            key={b.note}
            type="button"
            className={`bowl-btn${i === bowlIdx ? ' active' : ''}`}
            style={
              {
                '--btn-hue': b.hue,
                '--btn-glow': `${b.glow[0]}, ${b.glow[1]}, ${b.glow[2]}`
              } as React.CSSProperties
            }
            onClick={() => selectBowl(i)}
            aria-pressed={i === bowlIdx}
            aria-label={`${b.label} bowl, ${b.note}, ${b.freq.toFixed(2)} hertz`}
          >
            <span className="bowl-btn-note">{b.note}</span>
            <span className="bowl-btn-key">{i + 1}</span>
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
            hsla(var(--hue), 80%, 78%, 1),
            hsla(var(--hue), 60%, 40%, 1) 60%,
            hsla(var(--hue), 70%, 20%, 1) 100%
          );
          box-shadow: 0 0 18px rgba(var(--glow), 0.5);
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
        }
        .modes {
          display: flex;
          gap: 3px;
          padding: 3px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 12px;
        }
        .mode-btn {
          width: clamp(28px, 4.4vmin, 36px);
          height: clamp(28px, 4.4vmin, 32px);
          border-radius: 9px;
          color: var(--t2);
          font-family: var(--sans), system-ui, sans-serif;
          font-size: clamp(10px, 1.5vmin, 12px);
          font-weight: 600;
          letter-spacing: 0.08em;
          display: grid;
          place-items: center;
          transition: background 0.25s ease, color 0.25s ease, box-shadow 0.3s ease,
            transform 0.2s ease;
        }
        .mode-btn:hover {
          color: var(--t1);
          background: rgba(255, 255, 255, 0.06);
        }
        .mode-btn:active {
          transform: scale(0.94);
        }
        .mode-btn.active {
          color: var(--t1);
          background: linear-gradient(
            180deg,
            hsla(var(--hue), 70%, 32%, 0.55),
            hsla(var(--hue), 70%, 18%, 0.45)
          );
          box-shadow: 0 0 12px rgba(var(--glow), 0.45),
            inset 0 0 8px rgba(var(--glow), 0.25);
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
        .bowl-meta {
          position: relative;
          z-index: 2;
          text-align: center;
          pointer-events: none;
          color: var(--t1);
          mix-blend-mode: screen;
          opacity: 0.9;
          transform: translateY(0);
        }
        .bowl-note {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 10px;
          font-family: var(--serif), Georgia, serif;
        }
        .bowl-note-letter {
          font-size: clamp(28px, 6vmin, 56px);
        }
        .bowl-note-freq {
          color: var(--t2);
          font-family: var(--sans), system-ui, sans-serif;
          font-size: clamp(11px, 1.6vmin, 14px);
          letter-spacing: 0.18em;
        }
        .bowl-label {
          color: var(--t2);
          letter-spacing: 0.32em;
          text-transform: uppercase;
          font-size: clamp(10px, 1.5vmin, 12px);
          margin-top: 6px;
        }
        .bowl-hint {
          margin-top: 14px;
          font-size: clamp(11px, 1.6vmin, 13px);
          color: var(--t2);
          opacity: 0.7;
        }

        .rail {
          grid-area: rail;
          display: flex;
          gap: clamp(6px, 1.2vmin, 14px);
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
        .bowl-btn {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: clamp(6px, 1.4vmin, 12px) clamp(4px, 1vmin, 12px);
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: linear-gradient(
            180deg,
            hsla(var(--btn-hue), 55%, 22%, 0.35),
            hsla(var(--btn-hue), 55%, 10%, 0.25)
          );
          color: var(--t1);
          transition: transform 0.18s ease, box-shadow 0.3s ease, background 0.3s ease,
            border-color 0.3s ease;
          min-height: 44px;
        }
        .shell.landscape .bowl-btn {
          min-width: 56px;
        }
        .bowl-btn:hover {
          border-color: rgba(255, 255, 255, 0.16);
          transform: translateY(-1px);
        }
        .bowl-btn.active {
          border-color: hsla(var(--btn-hue), 80%, 70%, 0.7);
          background: linear-gradient(
            180deg,
            hsla(var(--btn-hue), 70%, 35%, 0.55),
            hsla(var(--btn-hue), 70%, 18%, 0.45)
          );
          box-shadow: 0 0 24px rgba(var(--btn-glow), 0.45),
            inset 0 0 12px rgba(var(--btn-glow), 0.25);
        }
        .bowl-btn-note {
          font-family: var(--serif), Georgia, serif;
          font-size: clamp(16px, 2.6vmin, 22px);
          line-height: 1;
        }
        .bowl-btn-key {
          font-size: clamp(9px, 1.3vmin, 11px);
          letter-spacing: 0.16em;
          color: var(--t2);
        }

        @media (max-width: 420px) {
          .brand-name {
            display: none;
          }
          .slider span {
            display: none;
          }
          .sliders {
            gap: 14px;
          }
        }
      `}</style>
    </div>
  );
}
