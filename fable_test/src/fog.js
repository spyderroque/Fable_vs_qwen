// Fog of war: a small DataTexture (one texel per tile) sampled by every
// environment/unit material via onBeforeCompile shader injection, so floors,
// walls and props all dim consistently. Linear filtering gives soft edges.
//
// States: unexplored (near-black) / explored-but-unseen (dim) / visible (full).

import * as THREE from 'three';
import { TILE } from './config.js';
import { key } from './grid.js';

const LEVELS = { unexplored: 22, explored: 96, visible: 255 };

export class FogOfWar {
  constructor(mapW, mapH) {
    this.w = mapW; this.h = mapH;
    this.data = new Uint8Array(mapW * mapH).fill(LEVELS.unexplored);
    this.tex = new THREE.DataTexture(this.data, mapW, mapH, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    this.explored = new Set();
    this.uniforms = {
      uFowMap: { value: this.tex },
      uFowParams: { value: new THREE.Vector4(-TILE / 2, -TILE / 2, mapW * TILE, mapH * TILE) },
    };
  }

  patch(mat) {
    if (mat.userData.fowPatched) return mat;
    mat.userData.fowPatched = true;
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFowMap = uniforms.uFowMap;
      shader.uniforms.uFowParams = uniforms.uFowParams;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFowWorld;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvFowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform sampler2D uFowMap;\nuniform vec4 uFowParams;\nvarying vec3 vFowWorld;')
        .replace('#include <dithering_fragment>',
          `#include <dithering_fragment>
           vec2 fowUv = (vFowWorld.xz - uFowParams.xy) / uFowParams.zw;
           float fow = texture2D(uFowMap, fowUv).r;
           gl_FragColor.rgb *= fow;`);
    };
    mat.customProgramCacheKey = () => 'fow';
    return mat;
  }

  // visibleKeys: Set of grid keys currently seen by the squad.
  update(visibleKeys) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const k = key(x, y);
        const i = y * this.w + x;
        if (visibleKeys.has(k)) {
          this.explored.add(k);
          this.data[i] = LEVELS.visible;
        } else {
          this.data[i] = this.explored.has(k) ? LEVELS.explored : LEVELS.unexplored;
        }
      }
    }
    this.tex.needsUpdate = true;
  }
}
