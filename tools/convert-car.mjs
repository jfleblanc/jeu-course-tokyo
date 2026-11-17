/**
 * Convertit un modèle de voiture glTF (Sketchfab) en GLB léger pour le jeu.
 *
 *   node tools/convert-car.mjs <dossier du glTF décompressé> <id> <sortie.glb>
 *
 * - applique les transformations, fusionne par matériau, simplifie (meshoptimizer) ;
 * - sépare une roue modèle (réutilisée quatre fois par le jeu) de la carrosserie ;
 * - recentre : origine au sol, au milieu des essieux, z vers l'avant, à l'échelle du jeu ;
 * - produit deux niveaux de détail : `body` / `wheel` (joueur) et `body_lod1` / `wheel_lod1`.
 *
 * meshoptimizer n'est pas une dépendance du jeu : indiquer son dossier `js/` avec MESHOPT_JS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CARS = {
  'datsun-240k': {
    credit: '« (FREE) 1972 Datsun 240k GT » par Karol Miklas — CC-BY-SA-4.0 — https://sketchfab.com/3d-models/free-1972-datsun-240k-gt-b2303a552b444e5b8637fdf5169b41cb',
    root: 'RootNode',
    wheelNode: 'Cylinder.013', // roue complète servant de modèle
    wheelNodes: ['Cylinder.013', 'Cylinder.007'], // un essieu chacun (même côté)
    drop: ['Plane.035', 'Cylinder.007', 'Cylinder.010', 'Cylinder.009'],
    dropMaterials: ['coat'], // coque de vernis : refaite par le matériau du jeu
    wheelMaterials: ['alloy', 'tire', 'black_paint'], // retirés de la carrosserie près des roues
    // matériaux regroupés (moins d'appels de dessin) : nom d'origine → nom final
    merge: { alloy: 'chrome', black_paint: 'black_matte', tire: 'black_matte' },
    wheelMerge: { black_paint: 'tire' },
    wheelbase: 2.62,
    textures: { license: 256, stickers: 512 },
    // part des triangles gardée par matériau (niveau 0) ; `*` = défaut
    keep: { paint: 0.14, glass: 0.4, chrome: 0.024, black_matte: 0.032, black_paint: 0.04, headlights: 0.06, red_glass: 0.15, orange_glass: 0.15, license: 1, stickers: 1, alloy: 0.04, tire: 0.04, '*': 0.05 },
    wheelKeep: 0.035,
    lod1: 0.22,
  },
};

const [, , dir, id, out] = process.argv;
const cfg = CARS[id];
if (!dir || !cfg || !out) throw new Error('usage : convert-car.mjs <dossier> <' + Object.keys(CARS).join('|') + '> <sortie.glb>');
const { MeshoptSimplifier } = await import(pathToFileURL(path.join(process.env.MESHOPT_JS ?? '', 'meshopt_simplifier.js')).href);
await MeshoptSimplifier.ready;

const g = JSON.parse(fs.readFileSync(path.join(dir, 'scene.gltf'), 'utf8'));
const bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function local(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}
function read(i, comps) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  const off = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = a.count;
  if (a.componentType === 5126) {
    const stride = bv.byteStride ?? comps * 4;
    const o = new Float32Array(n * comps); const dv = new DataView(bin.buffer, off);
    for (let k = 0; k < n; k++) for (let c = 0; c < comps; c++) o[k * comps + c] = dv.getFloat32(k * stride + c * 4, true);
    return o;
  }
  const dv = new DataView(bin.buffer, off); const o = new Uint32Array(n);
  for (let k = 0; k < n; k++) o[k] = a.componentType === 5125 ? dv.getUint32(k * 4, true) : a.componentType === 5123 ? dv.getUint16(k * 2, true) : dv.getUint8(k);
  return o;
}

/** Morceaux par (pièce, matériau) : listes de tableaux à concaténer. */
const chunks = new Map();
function add(part, mat, pos, nor, uv, idx) {
  const key = part + '|' + mat; let c = chunks.get(key);
  if (!c) chunks.set(key, (c = { part, mat, pos: [], nor: [], uv: [], idx: [], count: 0 }));
  const shifted = new Uint32Array(idx.length); for (let k = 0; k < idx.length; k++) shifted[k] = idx[k] + c.count;
  c.pos.push(pos); c.nor.push(nor); c.uv.push(uv); c.idx.push(shifted); c.count += pos.length / 3;
}
function walk(i, m, top) {
  const n = g.nodes[i]; const w = mul(m, local(n));
  const flip = (w[0] * (w[5] * w[10] - w[6] * w[9]) - w[4] * (w[1] * w[10] - w[2] * w[9]) + w[8] * (w[1] * w[6] - w[2] * w[5])) < 0;
  if (n.mesh !== undefined && top && !cfg.drop.includes(top)) for (const p of g.meshes[n.mesh].primitives) {
    const mat = g.materials[p.material].name;
    if (cfg.dropMaterials.includes(mat)) continue;
    const P = read(p.attributes.POSITION, 3); const N = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL, 3) : new Float32Array(P.length);
    const U = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0, 2) : new Float32Array((P.length / 3) * 2);
    const idx = read(p.indices, 1);
    for (let k = 0; k < P.length; k += 3) {
      const x = P[k], y = P[k + 1], z = P[k + 2];
      P[k] = w[0] * x + w[4] * y + w[8] * z + w[12]; P[k + 1] = w[1] * x + w[5] * y + w[9] * z + w[13]; P[k + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
      const a = N[k], b = N[k + 1], c = N[k + 2];
      let nx = w[0] * a + w[4] * b + w[8] * c, ny = w[1] * a + w[5] * b + w[9] * c, nz = w[2] * a + w[6] * b + w[10] * c; const l = Math.hypot(nx, ny, nz) || 1;
      N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
    }
    if (flip) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    add(top, mat, P, N, U, idx);
  }
  for (const c of n.children ?? []) walk(c, w, top ?? (n.name === cfg.root ? undefined : top), n.name === cfg.root);
}
function find(i, m) { const n = g.nodes[i]; const w = mul(m, local(n)); if (n.name === cfg.root) { for (const c of n.children) walk(c, w, g.nodes[c].name); } else for (const c of n.children ?? []) find(c, w); }
// les roues de référence sont lues même si elles sont dans `drop`
const dropSaved = cfg.drop; cfg.drop = cfg.drop.filter((d) => !cfg.wheelNodes.includes(d));
for (const r of g.scenes[0].nodes) find(r, I);
cfg.drop = dropSaved;

const cat = (list, T) => { const n = list.reduce((s, a) => s + a.length, 0); const o = new T(n); let off = 0; for (const a of list) { o.set(a, off); off += a.length; } return o; };
const meshes = [...chunks.values()].map((c) => ({ part: c.part, mat: c.mat, pos: cat(c.pos, Float32Array), nor: cat(c.nor, Float32Array), uv: cat(c.uv, Float32Array), idx: cat(c.idx, Uint32Array) }));
const bbox = (list) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const m of list) for (let k = 0; k < m.pos.length; k++) { const a = k % 3; if (m.pos[k] < lo[a]) lo[a] = m.pos[k]; if (m.pos[k] > hi[a]) hi[a] = m.pos[k]; } return { lo, hi, c: lo.map((v, k) => (v + hi[k]) / 2) }; };

// — Repère du jeu —
const wheelBoxes = cfg.wheelNodes.map((n) => bbox(meshes.filter((m) => m.part === n)));
const bodyAll = meshes.filter((m) => !cfg.wheelNodes.includes(m.part));
const bb = bbox(bodyAll);
const axleZ = wheelBoxes.map((b) => b.c[2]).sort((a, b) => a - b);
const scale = cfg.wheelbase / (axleZ[1] - axleZ[0]);
const origin = [bb.c[0], Math.min(...wheelBoxes.map((b) => b.lo[1])), (axleZ[0] + axleZ[1]) / 2];
const wheelRadius = ((wheelBoxes[0].hi[1] - wheelBoxes[0].lo[1]) / 2) * scale;
const halfTrack = Math.abs(wheelBoxes[0].c[0] - bb.c[0]) * scale;
const wheelSide = Math.sign(wheelBoxes[0].c[0] - bb.c[0]);
const wheelCentres = []; for (const b of wheelBoxes) for (const s of [1, -1]) wheelCentres.push([bb.c[0] + s * Math.abs(b.c[0] - bb.c[0]), b.c[1], b.c[2]]);

// — Carrosserie : retirer les roues modélisées dedans —
const rawR = (wheelBoxes[0].hi[1] - wheelBoxes[0].lo[1]) / 2, rawW = wheelBoxes[0].hi[0] - wheelBoxes[0].lo[0];
for (const m of bodyAll) {
  if (!cfg.wheelMaterials.includes(m.mat)) continue;
  const keep = [];
  for (let k = 0; k < m.idx.length; k += 3) {
    let cx = 0, cy = 0, cz = 0; for (let j = 0; j < 3; j++) { const v = m.idx[k + j] * 3; cx += m.pos[v] / 3; cy += m.pos[v + 1] / 3; cz += m.pos[v + 2] / 3; }
    const inWheel = wheelCentres.some((c) => Math.abs(cx - c[0]) < rawW * 0.75 && Math.hypot(cy - c[1], cz - c[2]) < rawR * 1.04);
    if (!inWheel) keep.push(m.idx[k], m.idx[k + 1], m.idx[k + 2]);
  }
  m.idx = new Uint32Array(keep);
}

function toGame(m, centre) {
  for (let k = 0; k < m.pos.length; k += 3) { m.pos[k] = (m.pos[k] - centre[0]) * scale; m.pos[k + 1] = (m.pos[k + 1] - centre[1]) * scale; m.pos[k + 2] = (m.pos[k + 2] - centre[2]) * scale; }
}
/** Fusionne les pièces de même matériau. */
function mergeByMat(list) {
  const by = new Map();
  for (const m of list) { if (!m.idx.length) continue; const a = by.get(m.mat) ?? []; a.push(m); by.set(m.mat, a); }
  return [...by.entries()].map(([mat, ms]) => {
    let off = 0; const idx = [];
    for (const m of ms) { const s = new Uint32Array(m.idx.length); for (let k = 0; k < s.length; k++) s[k] = m.idx[k] + off; idx.push(s); off += m.pos.length / 3; }
    return { mat, pos: cat(ms.map((m) => m.pos), Float32Array), nor: cat(ms.map((m) => m.nor), Float32Array), uv: cat(ms.map((m) => m.uv), Float32Array), idx: cat(idx, Uint32Array) };
  });
}
function simplify(m, ratio) {
  let idx = m.idx;
  if (ratio < 1 && idx.length > 600) {
    const target = Math.max(300, Math.floor((idx.length * ratio) / 3) * 3);
    [idx] = MeshoptSimplifier.simplifyWithAttributes(idx, m.pos, 3, m.nor, 3, [0.6, 0.6, 0.6], null, target, 0.05, ['Prune']);
  }
  // compacter
  const remap = new Int32Array(m.pos.length / 3).fill(-1); let n = 0; const oi = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) { const v = idx[k]; if (remap[v] < 0) remap[v] = n++; oi[k] = remap[v]; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let v = 0; v < remap.length; v++) { const r = remap[v]; if (r < 0) continue; pos.set(m.pos.subarray(v * 3, v * 3 + 3), r * 3); nor.set(m.nor.subarray(v * 3, v * 3 + 3), r * 3); uv.set(m.uv.subarray(v * 2, v * 2 + 2), r * 2); }
  return { mat: m.mat, pos, nor, uv, idx: oi };
}

for (const m of bodyAll) m.mat = cfg.merge?.[m.mat] ?? m.mat;
const wheelRaw = meshes.filter((m) => m.part === cfg.wheelNode); for (const m of wheelRaw) m.mat = cfg.wheelMerge?.[m.mat] ?? m.mat;
const body = mergeByMat(bodyAll); body.forEach((m) => toGame(m, origin));
const wheelSrc = mergeByMat(wheelRaw); wheelSrc.forEach((m) => toGame(m, wheelBoxes[cfg.wheelNodes.indexOf(cfg.wheelNode)].c));
const ratio = (mat) => cfg.keep[mat] ?? cfg.keep['*'];
const parts = {
  body: body.map((m) => simplify(m, ratio(m.mat))),
  body_lod1: body.map((m) => simplify(m, Math.min(1, ratio(m.mat) * cfg.lod1 * (ratio(m.mat) >= 1 ? 1 / cfg.lod1 : 1)))),
  wheel: wheelSrc.map((m) => simplify(m, cfg.wheelKeep)),
  wheel_lod1: wheelSrc.map((m) => simplify(m, cfg.wheelKeep * cfg.lod1)),
};

// — Écriture du GLB —
const buffers = []; let length = 0;
const views = [], accessors = [], images = [], textures = [], materials = [], gm = [], nodes = [];
function view(data, target) { const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength); const pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: length, byteLength: b.length, ...(target ? { target } : {}) }); buffers.push(b, Buffer.alloc(pad)); length += b.length + pad; return views.length - 1; }
function accessor(data, type, comp, minmax) { const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]; const a = { bufferView: view(data, comp === 5125 ? 34963 : 34962), componentType: comp, count: data.length / n, type }; if (minmax) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let k = 0; k < data.length; k++) { lo[k % 3] = Math.min(lo[k % 3], data[k]); hi[k % 3] = Math.max(hi[k % 3], data[k]); } a.min = lo; a.max = hi; } accessors.push(a); return accessors.length - 1; }
const matIndex = new Map();
function material(name) {
  if (matIndex.has(name)) return matIndex.get(name);
  const src = g.materials.find((m) => m.name === name); const pbr = { ...(src.pbrMetallicRoughness ?? {}) };
  delete pbr.metallicRoughnessTexture;
  if (pbr.baseColorTexture) {
    const size = cfg.textures[name];
    if (size) {
      const file = path.join(process.env.TEX_DIR ?? dir, `${id}-${name}.png`);
      images.push({ bufferView: view(new Uint8Array(fs.readFileSync(file))), mimeType: 'image/png' });
      textures.push({ source: images.length - 1 }); pbr.baseColorTexture = { index: textures.length - 1 };
    } else delete pbr.baseColorTexture;
  }
  const m = { name, pbrMetallicRoughness: pbr }; if (src.alphaMode) m.alphaMode = src.alphaMode; if (src.alphaCutoff !== undefined) m.alphaCutoff = src.alphaCutoff; if (src.doubleSided) m.doubleSided = true;
  materials.push(m); matIndex.set(name, materials.length - 1); return materials.length - 1;
}
const stats = {};
for (const [name, list] of Object.entries(parts)) {
  const prims = []; let tri = 0;
  for (const m of list) {
    if (!m.idx.length) continue; tri += m.idx.length / 3;
    const attributes = { POSITION: accessor(m.pos, 'VEC3', 5126, true), NORMAL: accessor(m.nor, 'VEC3', 5126) };
    if (cfg.textures[m.mat]) attributes.TEXCOORD_0 = accessor(m.uv, 'VEC2', 5126);
    prims.push({ attributes, indices: accessor(m.idx, 'SCALAR', 5125), material: material(m.mat) });
  }
  gm.push({ name, primitives: prims }); nodes.push({ name, mesh: gm.length - 1 }); stats[name] = tri;
}
const gb = bbox(parts.body);
const extras = { id, credit: cfg.credit, wheelRadius: +wheelRadius.toFixed(4), halfTrack: +halfTrack.toFixed(4), axleFrontZ: +(cfg.wheelbase / 2).toFixed(4), axleRearZ: -+(cfg.wheelbase / 2).toFixed(4), wheelSide, size: gb.hi.map((v, k) => +(v - gb.lo[k]).toFixed(3)), min: gb.lo.map((v) => +v.toFixed(3)), max: gb.hi.map((v) => +v.toFixed(3)), triangles: stats };
const json = { asset: { version: '2.0', generator: 'jeu-course-tokyo convert-car', copyright: cfg.credit }, scene: 0, scenes: [{ nodes: nodes.map((_, k) => k), extras }], nodes, meshes: gm, materials, accessors, bufferViews: views, buffers: [{ byteLength: length }], ...(images.length ? { images, textures, samplers: [{}] } : {}) };
if (images.length) textures.forEach((t) => (t.sampler = 0));
let jb = Buffer.from(JSON.stringify(json)); jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
const body2 = Buffer.concat(buffers); const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + body2.length, 8);
const h1 = Buffer.alloc(8); h1.writeUInt32LE(jb.length, 0); h1.writeUInt32LE(0x4e4f534a, 4); const h2 = Buffer.alloc(8); h2.writeUInt32LE(body2.length, 0); h2.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.concat([head, h1, jb, h2, body2]));
console.log(JSON.stringify(extras, null, 1)); console.log('fichier', (fs.statSync(out).size / 1e6).toFixed(2), 'Mo');
for (const [n, l] of Object.entries(parts)) console.log(n, l.map((m) => `${m.mat}:${m.idx.length / 3}`).join(' '));
