// Visual effects & procedural audio: a tiny tween engine drives unit movement,
// tracers, sparks, explosions and death falls. All sounds are synthesized
// with WebAudio oscillators/noise — no audio files.

import * as THREE from 'three';
import { TILE } from './config.js';

class Sounds {
  constructor() { this.ctx = null; this.muted = false; }
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  _env(gain, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    g.connect(this.ctx.destination);
    return g;
  }
  blip(f0, f1, dur, type = 'square', gain = 0.06) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), this.ctx.currentTime + dur);
    o.connect(this._env(gain, dur));
    o.start(); o.stop(this.ctx.currentTime + dur);
  }
  noise(dur, gain = 0.08, freq = 800) {
    if (!this.ctx || this.muted) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = freq;
    src.connect(lp); lp.connect(this._env(gain, dur));
    src.start();
  }
  shoot()    { this.blip(900, 160, 0.12, 'square', 0.05); this.noise(0.08, 0.04, 2500); }
  plasma()   { this.blip(300, 1400, 0.16, 'sawtooth', 0.04); }
  hit()      { this.noise(0.12, 0.09, 1200); }
  miss()     { this.blip(500, 420, 0.08, 'sine', 0.03); }
  explosion(){ this.noise(0.55, 0.22, 300); this.blip(120, 30, 0.5, 'sine', 0.12); }
  select()   { this.blip(700, 1000, 0.05, 'sine', 0.03); }
  move()     { this.blip(420, 520, 0.05, 'sine', 0.02); }
  overwatch(){ this.blip(520, 760, 0.18, 'triangle', 0.04); }
  reload()   { this.blip(250, 180, 0.07, 'square', 0.04); setTimeout(() => this.blip(320, 420, 0.06, 'square', 0.04), 110); }
  heal()     { this.blip(600, 1200, 0.25, 'sine', 0.04); }
  poison()   { this.blip(300, 140, 0.3, 'sawtooth', 0.03); }
  death()    { this.blip(220, 40, 0.4, 'sawtooth', 0.06); }
  uiError()  { this.blip(200, 150, 0.1, 'square', 0.03); }
}

export class FX {
  constructor(scene, rig) {
    this.scene = scene;
    this.rig = rig;
    this.tweens = [];
    this.particles = [];
    this.sounds = new Sounds();
  }

  tween(dur, fn) {
    return new Promise(resolve => {
      this.tweens.push({ t: 0, dur, fn, resolve });
    });
  }

  wait(s) { return this.tween(s, () => {}); }

  update(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      const pos = p.points.geometry.attributes.position;
      for (let j = 0; j < p.vel.length; j++) {
        p.vel[j].y -= 9.8 * dt * p.gravity;
        pos.setXYZ(j,
          pos.getX(j) + p.vel[j].x * dt,
          Math.max(0.02, pos.getY(j) + p.vel[j].y * dt),
          pos.getZ(j) + p.vel[j].z * dt);
      }
      pos.needsUpdate = true;
      p.points.material.opacity = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  // Walk a unit's mesh along grid waypoints. onStep(i) is called as each tile is
  // reached and may return 'stop' to cut the move short (overwatch kills, etc).
  async moveUnit(group, path, unit, onStep) {
    const speed = 7.5; // tiles/sec in world steps
    for (let i = 0; i < path.length; i++) {
      const from = group.position.clone();
      const to = new THREE.Vector3(path[i].x * TILE, 0, path[i].y * TILE);
      const d = from.distanceTo(to) / TILE;
      group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      await this.tween(Math.max(0.06, d / speed), k => {
        group.position.lerpVectors(from, to, k);
        group.position.y = Math.sin(k * Math.PI) * 0.06;
      });
      group.position.y = 0;
      unit.x = path[i].x; unit.y = path[i].y;
      if (onStep) {
        const r = await onStep(i);
        if (r === 'stop' || !unit.alive) return i;
      }
    }
    return path.length - 1;
  }

  muzzleFlash(pos) {
    const light = new THREE.PointLight(0xffd27a, 30, 9, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.tween(0.1, k => { light.intensity = 30 * (1 - k); })
      .then(() => this.scene.remove(light));
  }

  async tracer(from, to, color = 0xffe08a) {
    this.muzzleFlash(from);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const streakLen = Math.min(1.6, len * 0.4);
    const geo = new THREE.BoxGeometry(0.05, 0.05, streakLen);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const streak = new THREE.Mesh(geo, mat);
    streak.position.copy(from);
    streak.lookAt(to);
    this.scene.add(streak);
    await this.tween(Math.max(0.09, len / 70), k => {
      streak.position.lerpVectors(from, to, k);
    });
    this.scene.remove(streak);
    geo.dispose(); mat.dispose();
  }

  burst(pos, color, n, spread = 2.6, gravity = 1) {
    const positions = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        Math.random() * spread * 0.8,
        (Math.random() - 0.5) * spread));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.particles.push({ points, vel, life: 0.55, maxLife: 0.55, gravity });
  }

  async impact(pos, hit) {
    if (hit) { this.burst(pos, 0xff7a4a, 14); this.sounds.hit(); }
    else {
      const behind = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.3, (Math.random() - 0.5) * 1.6));
      this.burst(behind, 0x9aa4b0, 8, 1.6);
      this.sounds.miss();
    }
  }

  async grenadeArc(from, to) {
    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa835 });
    const nade = new THREE.Mesh(geo, mat);
    nade.position.copy(from);
    this.scene.add(nade);
    const height = Math.max(2.5, from.distanceTo(to) * 0.25);
    await this.tween(0.6, k => {
      nade.position.lerpVectors(from, to, k);
      nade.position.y += Math.sin(k * Math.PI) * height;
    });
    this.scene.remove(nade);
    geo.dispose(); mat.dispose();
  }

  async explosion(pos, radiusWorld) {
    this.sounds.explosion();
    this.rig.addShake(1.1);
    const light = new THREE.PointLight(0xff9540, 80, radiusWorld * 4, 2);
    light.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    this.scene.add(light);
    this.burst(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffb054, 46, 7, 1.4);
    this.burst(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0x55504a, 30, 5, 0.9);
    const ringGeo = new THREE.RingGeometry(0.1, 0.16, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).add(new THREE.Vector3(0, 0.1, 0));
    this.scene.add(ring);
    await this.tween(0.45, k => {
      light.intensity = 80 * (1 - k);
      const s = 1 + k * radiusWorld * 6;
      ring.scale.set(s, s, s);
      ringMat.opacity = 1 - k;
    });
    this.scene.remove(light); this.scene.remove(ring);
    ringGeo.dispose(); ringMat.dispose();
  }

  async deathFall(group) {
    this.sounds.death();
    const dir = Math.random() > 0.5 ? 1 : -1;
    const r0 = group.rotation.z;
    await this.tween(0.45, k => {
      const e = k * k;
      group.rotation.z = r0 + dir * e * Math.PI / 2;
      group.position.y = -e * 0.15;
    });
  }
}
