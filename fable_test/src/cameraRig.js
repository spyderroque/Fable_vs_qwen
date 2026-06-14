// XCOM-style tactical camera: fixed pitch, 90° yaw snaps, smooth pan/zoom,
// plus a tiny screen-shake channel for explosions.

import * as THREE from 'three';

const PITCH = THREE.MathUtils.degToRad(52);

export class CameraRig {
  constructor(camera, bounds) {
    this.camera = camera;
    this.bounds = bounds; // {minX, maxX, minZ, maxZ}
    this.target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, bounds.maxZ - 6);
    this.desired = this.target.clone();
    // yaw 0 puts the camera south of the target looking north, so the squad
    // (spawning at the map's south edge) sees the battlefield ahead.
    this.yaw = 0; this.desiredYaw = 0;
    this.dist = 20; this.desiredDist = 20;
    this.keys = new Set();
    this.shake = 0;
    this._tmp = new THREE.Vector3();
  }

  setKey(code, down) { down ? this.keys.add(code) : this.keys.delete(code); }
  rotate(dir) { this.desiredYaw += dir * Math.PI / 2; }
  zoom(delta) { this.desiredDist = THREE.MathUtils.clamp(this.desiredDist + delta, 9, 34); }
  addShake(m) { this.shake = Math.max(this.shake, m); }

  focusOn(x, z, immediate = false) {
    this.desired.set(
      THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX), 0,
      THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ));
    if (immediate) this.target.copy(this.desired);
  }

  // Screen-space basis on the ground plane: with the camera at
  // target + (sin yaw, _, cos yaw)·dist, screen-up is f=(-sin,-cos) and
  // screen-right is r=(cos,-sin).
  panDrag(dx, dy) {
    const k = this.dist * 0.0016;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.desired.x += (-c * dx - s * dy) * k;
    this.desired.z += (s * dx - c * dy) * k;
    this._clampDesired();
  }

  _clampDesired() {
    this.desired.x = THREE.MathUtils.clamp(this.desired.x, this.bounds.minX, this.bounds.maxX);
    this.desired.z = THREE.MathUtils.clamp(this.desired.z, this.bounds.minZ, this.bounds.maxZ);
  }

  update(dt) {
    // keyboard pan, camera-relative (W pans toward screen-up, D toward screen-right)
    const speed = 16 * (this.dist / 20) * dt;
    let mx = 0, mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (mx || mz) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.desired.x += (mz * s + mx * c) * speed;
      this.desired.z += (mz * c - mx * s) * speed;
      this._clampDesired();
    }

    const k = 1 - Math.exp(-dt * 7);
    this.target.lerp(this.desired, k);
    this.yaw += (this.desiredYaw - this.yaw) * (1 - Math.exp(-dt * 9));
    this.dist += (this.desiredDist - this.dist) * (1 - Math.exp(-dt * 9));

    const cy = Math.cos(PITCH), sy = Math.sin(PITCH);
    this._tmp.set(
      this.target.x + Math.sin(this.yaw) * cy * this.dist,
      this.target.y + sy * this.dist,
      this.target.z + Math.cos(this.yaw) * cy * this.dist);

    if (this.shake > 0.001) {
      this._tmp.x += (Math.random() - 0.5) * this.shake;
      this._tmp.y += (Math.random() - 0.5) * this.shake * 0.6;
      this._tmp.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
    }

    this.camera.position.copy(this._tmp);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  worldToScreen(v, width, height) {
    const p = this._tmp.set(v.x, v.y, v.z).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, behind: p.z > 1 };
  }
}
