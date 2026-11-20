// Reporte des animations de la bibliothèque « Universal Animation Library » (Quaternius, CC0,
// fichiers GLB du projet Mesh2Motion) sur le squelette du personnage Kaku (os de type Mixamo).
//   node tools/retarget-anim.mjs <dossier des animations> public/models/kaku.glb public/models/kaku-anims.json
// Principe : à chaque image, on calcule l'orientation de chaque os source dans le monde, on la
// reporte sur l'os cible en corrigeant la différence de pose de repos (direction de l'os), puis on
// revient en rotations locales. Le bassin suit aussi en hauteur (il faut bien s'agenouiller).
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from '../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

const [, , srcDir, targetFile, outFile] = process.argv;
const FPS = 15;
/** Clips à reporter : nom dans le jeu → fichier source. */
const CLIPS = { travail: 'fixing-kneeling', repos: 'idle-subtle', marche: 'walk' };
/** Os cible (Kaku) ← os source. */
const MAP = {
  Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_03', Neck: 'neck_01', Head: 'head',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
};
/** Enfant qui donne la direction de l'os, côté cible et côté source. */
const DIR = {
  Hips: ['Spine', 'spine_01'], Spine: ['Spine1', 'spine_02'], Spine1: ['Neck', 'neck_01'], Neck: ['Head', 'head'], Head: ['eye', 'head_leaf'],
  LeftShoulder: ['LeftArm', 'upperarm_l'], LeftArm: ['LeftForeArm', 'lowerarm_l'], LeftForeArm: ['LeftHand', 'hand_l'], LeftHand: ['LeftHandMiddle1', 'middle_01_l'],
  RightShoulder: ['RightArm', 'upperarm_r'], RightArm: ['RightForeArm', 'lowerarm_r'], RightForeArm: ['RightHand', 'hand_r'], RightHand: ['RightHandMiddle1', 'middle_01_r'],
  LeftUpLeg: ['LeftLeg', 'calf_l'], LeftLeg: ['LeftFoot', 'foot_l'], LeftFoot: ['LeftToeBase', 'ball_l'], LeftToeBase: [null, 'ball_leaf_l'],
  RightUpLeg: ['RightLeg', 'calf_r'], RightLeg: ['RightFoot', 'foot_r'], RightFoot: ['RightToeBase', 'ball_r'], RightToeBase: [null, 'ball_leaf_r'],
};

// ——— Quaternions [x, y, z, w] et vecteurs ———
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
const vrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vnorm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Plus petite rotation qui amène la direction a sur la direction b. */
const arc = (a, b) => { a = vnorm(a); b = vnorm(b); const d = dot(a, b); if (d > 0.999999) return [0, 0, 0, 1]; if (d < -0.999999) { const ax = vnorm(cross(Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], a)); return [ax[0], ax[1], ax[2], 0]; } const c = cross(a, b); return qnorm([c[0], c[1], c[2], 1 + d]); };
const slerp = (a, b, t) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = b.map((v) => -v); d = -d; } if (d > 0.9995) return qnorm(a.map((v, i) => v + (b[i] - v) * t)); const th = Math.acos(d), s = Math.sin(th); const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s; return a.map((v, i) => v * wa + b[i] * wb); };

// ——— Lecture d'un GLB (hiérarchie, pose de repos, première animation) ———
await MeshoptDecoder.ready;
function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8);
  const view = (i) => {
    const bv = j.bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
    return Buffer.from(out.buffer);
  };
  const floats = (i) => {
    const a = j.accessors[i];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const v = view(a.bufferView);
    const stride = j.bufferViews[a.bufferView].byteStride || j.bufferViews[a.bufferView].extensions?.EXT_meshopt_compression?.byteStride || 0;
    const out = new Float32Array(a.count * n);
    const off = a.byteOffset ?? 0;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const p = off + k * (stride || n * (a.componentType === 5126 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1));
      if (a.componentType === 5126) out[k * n + c] = v.readFloatLE(p + c * 4);
      else if (a.componentType === 5122) out[k * n + c] = Math.max(-1, v.readInt16LE(p + c * 2) / 32767);
      else if (a.componentType === 5120) out[k * n + c] = Math.max(-1, v.readInt8(p + c) / 127);
      else throw new Error('type de données non géré : ' + a.componentType);
    }
    return { data: out, n, count: a.count };
  };
  const parent = new Map();
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const byName = new Map();
  j.nodes.forEach((n, i) => { const m = /^(?:CH_)?(.+?)(?:_\d+)?$/.exec(n.name ?? ''); byName.set(n.name, i); if (m) byName.set(m[1], i); });
  const anim = j.animations?.[0];
  const tracks = new Map(); // nœud → { rotation: {times, data}, translation: … }
  let duration = 0;
  if (anim) for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const times = floats(s.input).data, out = floats(s.output);
    duration = Math.max(duration, times[times.length - 1]);
    if (!tracks.has(ch.target.node)) tracks.set(ch.target.node, {});
    tracks.get(ch.target.node)[ch.target.path] = { times, data: out.data, n: out.n };
  }
  const sample = (tr, t, quat) => {
    const { times, data, n } = tr;
    let k = 0;
    while (k < times.length - 2 && times[k + 1] < t) k++;
    const t0 = times[k], t1 = times[Math.min(k + 1, times.length - 1)];
    const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const a = Array.from(data.subarray(k * n, k * n + n)), bb = Array.from(data.subarray(Math.min(k + 1, times.length - 1) * n, Math.min(k + 1, times.length - 1) * n + n));
    return quat ? slerp(qnorm(a), qnorm(bb), u) : a.map((v, i) => v + (bb[i] - v) * u);
  };
  /** Pose dans le monde de tous les nœuds à l'instant t (t < 0 : pose de repos du fichier). */
  const pose = (t) => {
    const R = new Array(j.nodes.length), P = new Array(j.nodes.length), S = new Array(j.nodes.length);
    const visit = (i) => {
      if (R[i]) return;
      const n = j.nodes[i], tr = t >= 0 ? tracks.get(i) : null;
      const r = tr?.rotation ? sample(tr.rotation, t, true) : qnorm(n.rotation ?? [0, 0, 0, 1]);
      const p = tr?.translation ? sample(tr.translation, t, false) : (n.translation ?? [0, 0, 0]);
      const s = n.scale ?? [1, 1, 1];
      const par = parent.get(i);
      if (par === undefined) { R[i] = r; P[i] = p; S[i] = s; return; }
      visit(par);
      R[i] = qmul(R[par], r);
      P[i] = vadd(P[par], vrot(R[par], [p[0] * S[par][0], p[1] * S[par][1], p[2] * S[par][2]]));
      S[i] = [s[0] * S[par][0], s[1] * S[par][1], s[2] * S[par][2]];
    };
    j.nodes.forEach((_, i) => visit(i));
    return { R, P, S };
  };
  return { j, parent, byName, pose, duration, name: (i) => j.nodes[i].name };
}

const T = readGlb(targetFile);
const tRest = T.pose(-1);
const tId = (b) => { const i = T.byName.get(b); if (i === undefined) throw new Error('os cible introuvable : ' + b); return i; };
/** « Avant » d'un squelette : produit vectoriel de l'axe des épaules et de la verticale. */
const forward = (P, l, r) => vnorm(cross(vsub(P[l], P[r]), [0, 1, 0]));
const tFwd = forward(tRest.P, tId('LeftArm'), tId('RightArm'));
const out = { fps: FPS, source: 'Universal Animation Library (Quaternius, CC0), via Mesh2Motion', clips: {} };

for (const [clipName, file] of Object.entries(CLIPS)) {
  const S = readGlb(path.join(srcDir, file + '.glb'));
  const sId = (b) => { const i = S.byName.get(b); if (i === undefined) throw new Error('os source introuvable : ' + b); return i; };
  const sRest = S.pose(-1);
  // Les deux personnages regardent-ils dans la même direction ? Sinon on tourne la source autour de la verticale.
  const sFwd = forward(sRest.P, sId('upperarm_l'), sId('upperarm_r'));
  const yaw = Math.atan2(tFwd[0], tFwd[2]) - Math.atan2(sFwd[0], sFwd[2]);
  const G = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  // Correction de pose de repos, os par os : la direction de l'os cible doit suivre celle de l'os source.
  const C = {};
  for (const [bone, src] of Object.entries(MAP)) {
    const [tc, sc] = DIR[bone];
    const ds = vrot(G, vsub(sRest.P[sId(sc)], sRest.P[sId(src)]));
    const tcId = tc ? T.byName.get(tc) : undefined;
    C[bone] = tcId === undefined ? null : arc(vsub(tRest.P[tcId], tRest.P[tId(bone)]), ds);
  }
  for (const side of ['Left', 'Right']) C[side + 'ToeBase'] = C[side + 'Foot'];
  const scale = (tRest.P[tId('Hips')][1] - tRest.P[tId('LeftFoot')][1]) / (sRest.P[sId('pelvis')][1] - sRest.P[sId('foot_l')][1]);
  const frames = Math.max(2, Math.round(S.duration * FPS) + 1);
  const tracks = {};
  for (const bone of Object.keys(MAP)) tracks[T.name(tId(bone))] = { q: [] };
  const hipsName = T.name(tId('Hips'));
  tracks[hipsName].p = [];
  const order = Object.keys(MAP); // parents avant enfants
  const hipsParent = T.parent.get(tId('Hips'));
  const hip0 = vrot(G, sRest.P[sId('pelvis')]);
  for (let f = 0; f < frames; f++) {
    const t = Math.min(S.duration, f / FPS);
    const sp = S.pose(t);
    const world = new Map(); // os cible → orientation dans le monde
    for (const bone of order) {
      const src = sId(MAP[bone]);
      const delta = qmul(qmul(G, sp.R[src]), qinv(qmul(G, sRest.R[src])));
      const w = qnorm(qmul(qmul(delta, C[bone]), tRest.R[tId(bone)]));
      world.set(tId(bone), w);
      // parent cible : s'il est reporté, son orientation animée ; sinon sa pose de repos
      const par = T.parent.get(tId(bone));
      const pw = world.get(par) ?? tRest.R[par];
      const local = qnorm(qmul(qinv(pw), w));
      tracks[T.name(tId(bone))].q.push(...local.map((v) => +v.toFixed(4)));
    }
    // Bassin : déplacement par rapport au repos, à l'échelle des jambes, dans le repère de son parent.
    const d = vsub(vrot(G, sp.P[sId('pelvis')]), hip0).map((v) => v * scale);
    const base = T.j.nodes[tId('Hips')].translation ?? [0, 0, 0];
    const local = vrot(qinv(tRest.R[hipsParent]), d).map((v, i) => v / tRest.S[hipsParent][i]);
    tracks[hipsName].p.push(...local.map((v, i) => +(base[i] + v).toFixed(4)));
  }
  out.clips[clipName] = { duration: +((frames - 1) / FPS).toFixed(4), frames, tracks };
  console.log(`${clipName} ← ${file} : ${frames} images, ${S.duration.toFixed(2)} s, échelle ${scale.toFixed(2)}, lacet ${(yaw * 57.3).toFixed(0)}°`);
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${outFile} : ${(fs.statSync(outFile).size / 1024).toFixed(0)} Ko`);
