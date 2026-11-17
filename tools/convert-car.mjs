/**
 * Convertit un modèle de voiture glTF (téléchargé sur Sketchfab, décompressé) en GLB léger pour le jeu.
 *
 *   MESHOPT_JS=<meshoptimizer/js> SHARP=<node_modules contenant sharp> \
 *     node tools/convert-car.mjs <dossier du glTF> <id> <sortie.glb>
 *
 * Ce que fait l'outil, sans dépendre de la façon dont le modèle est découpé :
 * - applique les transformations et oriente la voiture (+Z = avant, +Y = haut), à sa vraie longueur ;
 * - trouve les quatre roues par leur forme (pièces rondes posées au sol), en garde une comme
 *   modèle (le jeu la répète quatre fois) et les retire de la carrosserie ;
 * - range les matériaux dans quelques familles pour limiter les appels de dessin :
 *   `paint` (peinture réglable), `glass` (vitres), `lens` (verres de feux), `matte` / `metal` /
 *   `chrome` (couleur par sommet), `emit` (lumineux), `tail` (feux de frein), `head` (phares),
 *   `tex:<nom>` (texture gardée : plaque, autocollants, livrée) ;
 * - simplifie (meshoptimizer) à deux niveaux de détail : `body` / `wheel` et `body_lod1` / `wheel_lod1`.
 *
 * Réglages par voiture : `tools/cars.config.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CARS } from './cars.config.mjs';

const [, , dir, id, out] = process.argv;
const cfg = CARS[id];
if (!dir || !cfg || !out) throw new Error('usage : convert-car.mjs <dossier> <' + Object.keys(CARS).join('|') + '> <sortie.glb>');
const { MeshoptSimplifier } = await import(pathToFileURL(path.join(process.env.MESHOPT_JS ?? '', 'meshopt_simplifier.js')).href);
await MeshoptSimplifier.ready;
const sharp = createRequire(path.join(process.env.SHARP ?? process.cwd(), 'x.js'))('sharp');
const log = (...a) => console.log(...a);

// ───────────────────────── Lecture du glTF ─────────────────────────
const g = JSON.parse(fs.readFileSync(path.join(dir, 'scene.gltf'), 'utf8'));
const bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function local(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}
function read(i, comps) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
  const n = a.count;
  if (comps > 1 || a.componentType === 5126) {
    const size = { 5126: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
    const stride = bv.byteStride ?? comps * size;
    const o = new Float32Array(n * comps);
    for (let k = 0; k < n; k++) for (let c = 0; c < comps; c++) {
      const p = k * stride + c * size;
      o[k * comps + c] = a.componentType === 5126 ? dv.getFloat32(p, true) : a.componentType === 5123 ? dv.getUint16(p, true) / (a.normalized ? 65535 : 1) : a.componentType === 5121 ? dv.getUint8(p) / (a.normalized ? 255 : 1) : a.componentType === 5122 ? Math.max(dv.getInt16(p, true) / 32767, -1) : Math.max(dv.getInt8(p) / 127, -1);
    }
    return o;
  }
  const o = new Uint32Array(n);
  for (let k = 0; k < n; k++) o[k] = a.componentType === 5125 ? dv.getUint32(k * 4, true) : a.componentType === 5123 ? dv.getUint16(k * 2, true) : dv.getUint8(k);
  return o;
}

// Orientation : où est l'avant dans le fichier ?
const front = cfg.front ?? '+z';
const orient = (x, y, z) => (front === '+z' ? [x, y, z] : front === '-z' ? [-x, y, -z] : front === '+x' ? [-z, y, x] : [z, y, -x]);

/** Primitives à plat, dans le repère monde orienté : { mat, pos, nor, uv, idx }. */
const prims = [];
function walk(i, m) {
  const n = g.nodes[i]; const w = mul(m, local(n));
  if (cfg.dropNodes?.some((d) => (n.name ?? '').includes(d))) return;
  const flip = (w[0] * (w[5] * w[10] - w[6] * w[9]) - w[4] * (w[1] * w[10] - w[2] * w[9]) + w[8] * (w[1] * w[6] - w[2] * w[5])) < 0;
  if (n.mesh !== undefined) for (const p of g.meshes[n.mesh].primitives) {
    if ((p.mode ?? 4) !== 4 || p.material === undefined) continue;
    const P = read(p.attributes.POSITION, 3);
    const N = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL, 3) : null;
    const texCoord = g.materials[p.material].pbrMetallicRoughness?.baseColorTexture?.texCoord ?? 0;
    const U = p.attributes['TEXCOORD_' + texCoord] !== undefined ? read(p.attributes['TEXCOORD_' + texCoord], 2) : new Float32Array((P.length / 3) * 2);
    const idx = p.indices !== undefined ? read(p.indices, 1) : Uint32Array.from({ length: P.length / 3 }, (_, k) => k);
    const NN = new Float32Array(P.length);
    for (let k = 0; k < P.length; k += 3) {
      const x = P[k], y = P[k + 1], z = P[k + 2];
      const q = orient(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]);
      P[k] = q[0]; P[k + 1] = q[1]; P[k + 2] = q[2];
      if (N) {
        const a = N[k], b = N[k + 1], c = N[k + 2];
        const r = orient(w[0] * a + w[4] * b + w[8] * c, w[1] * a + w[5] * b + w[9] * c, w[2] * a + w[6] * b + w[10] * c); const l = Math.hypot(r[0], r[1], r[2]) || 1;
        NN[k] = r[0] / l; NN[k + 1] = r[1] / l; NN[k + 2] = r[2] / l;
      }
    }
    if (flip) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    if (!N) { // normales manquantes : normales de face accumulées
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) { NN[v] += nx; NN[v + 1] += ny; NN[v + 2] += nz; }
      }
      for (let k = 0; k < NN.length; k += 3) { const l = Math.hypot(NN[k], NN[k + 1], NN[k + 2]) || 1; NN[k] /= l; NN[k + 1] /= l; NN[k + 2] /= l; }
    }
    prims.push({ mat: p.material, pos: P, nor: NN, uv: U, idx });
  }
  for (const c of n.children ?? []) walk(c, w);
}
for (const r of g.scenes[g.scene ?? 0].nodes) walk(r, I);

// ───────────────────────── Matériaux : familles ─────────────────────────
const texCache = new Map();
/** Texture décodée en petit (pour la moyenne, la variance et la cuisson en couleurs par sommet). */
async function texture(index, size = 128) {
  const key = index + ':' + size;
  if (!texCache.has(key)) {
    const img = g.images[g.textures[index].source];
    const file = path.join(dir, decodeURIComponent(img.uri));
    const { data, info } = await sharp(file).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let s = [0, 0, 0, 0], s2 = 0; const n = info.width * info.height;
    for (let k = 0; k < n; k++) { for (let c = 0; c < 4; c++) s[c] += data[k * 4 + c] / 255; }
    s = s.map((v) => v / n);
    for (let k = 0; k < n; k++) { const l = (data[k * 4] + data[k * 4 + 1] + data[k * 4 + 2]) / 765 - (s[0] + s[1] + s[2]) / 3; s2 += l * l; }
    texCache.set(key, { data, w: info.width, h: info.height, mean: s, std: Math.sqrt(s2 / n), file });
  }
  return texCache.get(key);
}
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const has = (list, name) => (list ?? []).includes(name);
const triCount = new Map();
for (const p of prims) triCount.set(p.mat, (triCount.get(p.mat) ?? 0) + p.idx.length / 3);

const roles = []; // par matériau : { role, color:[r,g,b,a] linéaire, tex?:index, metal, rough }
for (let i = 0; i < g.materials.length; i++) {
  const m = g.materials[i], name = m.name ?? 'mat' + i, pbr = m.pbrMetallicRoughness ?? {};
  const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
  let metal = pbr.metallicFactor ?? 1, rough = pbr.roughnessFactor ?? 1;
  if (pbr.metallicRoughnessTexture) { const t = await texture(pbr.metallicRoughnessTexture.index, 32); metal *= t.mean[2]; rough *= t.mean[1]; }
  const tex = pbr.baseColorTexture ? await texture(pbr.baseColorTexture.index) : null;
  const color = tex ? [f[0] * lin(tex.mean[0]), f[1] * lin(tex.mean[1]), f[2] * lin(tex.mean[2]), f[3]] : [...f];
  const blend = m.alphaMode === 'BLEND' || (m.extensions?.KHR_materials_transmission && f[3] < 0.99);
  const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
  const emissive = (m.emissiveFactor ?? [0, 0, 0]).map((v) => v * strength);
  let role;
  if (has(cfg.drop, name) || /shadow|ombre/i.test(name)) role = 'drop';
  else if (has(cfg.paint, name)) role = 'paint';
  else if (has(cfg.tail, name)) role = 'tail';
  else if (has(cfg.head, name)) role = 'head';
  else if (has(cfg.glass, name)) role = 'glass';
  else if (has(cfg.lens, name)) role = 'lens';
  else if (has(cfg.emit, name)) role = 'emit';
  else if (has(cfg.keepTex, name) && tex) role = 'tex';
  else if (has(cfg.solid, name)) role = 'solid';
  else if (blend) role = /window|windshield|windscreen|vitre|glass_dark|glass_clear|clear_glass|glasswindow|^glass$/i.test(name) ? 'glass' : 'lens';
  else if (emissive.some((v) => v > 0.05) && /light|lamp|led|illum|display|lcd/i.test(name)) role = 'emit';
  else role = 'solid';
  roles.push({ name, role, color, tex, texIndex: pbr.baseColorTexture?.index, metal, rough, emissive, emissiveTex: m.emissiveTexture?.index, mask: m.alphaMode === 'MASK', doubleSided: !!m.doubleSided, tris: triCount.get(i) ?? 0 });
}
// Textures gardées automatiquement : celles qui ont du détail (plaque, feux, livrée), les plus grandes d'abord.
const autoKeep = roles.filter((r) => r.role === 'solid' && r.tex && (r.tex.std > (cfg.texStd ?? 0.1) || r.mask) && r.tris > 0 && !has(cfg.bake, r.name)).sort((a, b) => b.tris - a.tris).slice(0, cfg.maxTex ?? 5);
for (const r of autoKeep) r.role = 'tex';
for (const r of roles) {
  if (/tire|tyre|rubber|pneu|tread|sidewall|interior|plastic|seat|leather|fabric/i.test(r.name)) r.metal = Math.min(r.metal, 0.2);
  if (r.role === 'solid') r.bucket = has(cfg.matte, r.name) ? 'matte' : has(cfg.chrome, r.name) ? 'chrome' : r.metal >= 0.5 ? (r.rough < 0.3 ? 'chrome' : 'metal') : 'matte';
  else if (r.role === 'tex') r.bucket = 'tex:' + r.name;
  else r.bucket = r.role;
}

// ───────────────────────── Échelle, composantes connexes, roues ─────────────────────────
const live = prims.filter((p) => roles[p.mat].role !== 'drop');
const span = (list, axis) => { let lo = 1e9, hi = -1e9; for (const p of list) for (let k = axis; k < p.pos.length; k += 3) { if (p.pos[k] < lo) lo = p.pos[k]; if (p.pos[k] > hi) hi = p.pos[k]; } return [lo, hi]; };

// Composantes connexes (sommets soudés par position).
let size0 = span(live, 2); size0 = size0[1] - size0[0];
const q = size0 * 2e-5;
const ids = new Map(); const parent = [];
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (const p of live) {
  p.gid = new Uint32Array(p.pos.length / 3);
  for (let v = 0; v < p.gid.length; v++) {
    const key = Math.round(p.pos[v * 3] / q) + ',' + Math.round(p.pos[v * 3 + 1] / q) + ',' + Math.round(p.pos[v * 3 + 2] / q);
    let id2 = ids.get(key); if (id2 === undefined) { id2 = parent.length; parent.push(id2); ids.set(key, id2); }
    p.gid[v] = id2;
  }
  for (let k = 0; k < p.idx.length; k += 3) { const a = find(p.gid[p.idx[k]]), b = find(p.gid[p.idx[k + 1]]), c = find(p.gid[p.idx[k + 2]]); parent[b] = a; parent[find(c)] = a; }
}
ids.clear();
const comps = new Map(); // racine → { lo, hi, tris }
for (const p of live) for (let k = 0; k < p.idx.length; k += 3) {
  const root = find(p.gid[p.idx[k]]);
  let c = comps.get(root); if (!c) comps.set(root, (c = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], tris: 0 }));
  c.tris++;
  for (let j = 0; j < 3; j++) { const v = p.idx[k + j] * 3; for (let a = 0; a < 3; a++) { const x = p.pos[v + a]; if (x < c.lo[a]) c.lo[a] = x; if (x > c.hi[a]) c.hi[a] = x; } }
}
// Plans d'ombre au sol : très plats et très grands → retirés.
const zs = span(live, 2), xs = span(live, 0);
for (const c of comps.values()) c.flat = c.hi[1] - c.lo[1] < 0.004 * size0 && (c.hi[0] - c.lo[0]) * (c.hi[2] - c.lo[2]) > 0.5 * (xs[1] - xs[0]) * (zs[1] - zs[0]);

// Pièces rondes posées au sol = pneus et jantes.
const L0 = cfg.wheelSearchLength ?? size0;
const cand = [];
for (const [root, c] of comps) {
  if (c.flat) continue;
  const dx = c.hi[0] - c.lo[0], dy = c.hi[1] - c.lo[1], dz = c.hi[2] - c.lo[2];
  if (Math.abs(dy - dz) / dy < 0.12 && dx / dy > 0.12 && dx / dy < 0.92 && dy > (cfg.wheelMin ?? 0.115) * L0 && dy < (cfg.wheelMax ?? 0.2) * L0 && c.tris > 30) cand.push({ root, c, cx: (c.lo[0] + c.hi[0]) / 2, cy: (c.lo[1] + c.hi[1]) / 2, cz: (c.lo[2] + c.hi[2]) / 2, d: dy });
}
if (process.env.DEBUG_WHEELS) for (const [, c] of comps) { const dx = c.hi[0] - c.lo[0], dy = c.hi[1] - c.lo[1], dz = c.hi[2] - c.lo[2]; if (dy > 0.09 * L0 && dy < 0.25 * L0 && dz < 0.3 * L0 && c.tris > 30) log('  cand', c.tris, 'dx/dy', (dx / dy).toFixed(2), 'dy/dz', (dy / dz).toFixed(2), 'dy/L', (dy / L0).toFixed(3), 'x', ((c.lo[0] + c.hi[0]) / 2).toFixed(2), 'y0', c.lo[1].toFixed(2), 'z', ((c.lo[2] + c.hi[2]) / 2).toFixed(2)); }
if (!cand.length) throw new Error('aucune roue trouvée');
const ground0 = Math.min(...cand.map((k) => k.c.lo[1]));
const midX = (xs[0] + xs[1]) / 2;
const onGround = cand.filter((k) => k.c.lo[1] < ground0 + 0.035 * L0 && Math.abs(k.cx - midX) > 0.2 * (xs[1] - xs[0]));
const clusters = [];
for (const k of onGround.sort((a, b) => b.d - a.d)) {
  const cl = clusters.find((w) => Math.hypot(w.cy - k.cy, w.cz - k.cz) < 0.3 * w.d && Math.abs(w.cx - k.cx) < 0.6 * w.d);
  if (cl) { cl.xlo = Math.min(cl.xlo, k.c.lo[0]); cl.xhi = Math.max(cl.xhi, k.c.hi[0]); cl.roots.push(k.root); }
  else clusters.push({ cx: k.cx, cy: k.cy, cz: k.cz, d: k.d, xlo: k.c.lo[0], xhi: k.c.hi[0], aspect: (k.c.hi[0] - k.c.lo[0]) / k.d, roots: [k.root] });
}
if (clusters.length < 4) throw new Error(`seulement ${clusters.length} roue(s) trouvée(s)`);
const wheels = clusters.slice(0, 4).map((w) => ({ ...w, r: w.d / 2, side: Math.sign(w.cx - midX) }));
const ground = Math.min(...wheels.map((w) => w.cy - w.r));
// Roues braquées dans le fichier : plus « larges » que les autres. On ne les prend pas comme modèle.
const minAspect = Math.min(...wheels.map((w) => w.aspect));
for (const w of wheels) w.turned = w.aspect > minAspect * 1.25;
// ——— Repère propre de chaque roue ———
// Dans certains fichiers les roues ont du carrossage ou sont braquées. Les boîtes englobantes ne
// suffisent alors plus : on mesure l'axe réel, le centre et le rayon de chaque roue sur les sommets
// de son pneu, puis on teste les pièces dans ce repère (cylindre du pneu), sommet par sommet.
const near = new Map(); // racine → sommets (soudés) des composantes assez petites et proches d'une roue
for (const [root, c] of comps) {
  if (c.flat) continue;
  const mid = [0, 1, 2].map((a) => (c.lo[a] + c.hi[a]) / 2), dim = Math.max(c.hi[0] - c.lo[0], c.hi[1] - c.lo[1], c.hi[2] - c.lo[2]);
  if (wheels.some((w) => dim < 1.6 * w.d && Math.hypot(mid[0] - w.cx, mid[1] - w.cy, mid[2] - w.cz) < 1.2 * w.d)) near.set(root, []);
}
{
  const seen = new Set();
  for (const p of live) for (let v = 0; v < p.gid.length; v++) {
    const list = near.get(find(p.gid[v])); if (!list || seen.has(p.gid[v])) continue;
    seen.add(p.gid[v]); list.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]);
  }
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Coordonnées d'un point dans le repère d'une roue : [le long de l'axe, haut, avant]. */
const inWheel = (w, x, y, z) => { const d = [x - w.c[0], y - w.c[1], z - w.c[2]]; return [dot(d, w.axis), dot(d, w.up), dot(d, w.fwd)]; };
function setFrame(w, axis, c) { w.axis = axis; w.up = unit([-axis[0] * axis[1], 1 - axis[1] * axis[1], -axis[2] * axis[1]]); w.fwd = cross(axis, w.up); w.c = c; }
for (const w of wheels) {
  setFrame(w, [1, 0, 0], [w.cx, w.cy, w.cz]);
  const tyre = w.roots.map((r) => near.get(r));
  for (let it = 0; it < 3; it++) {
    // Axe : direction où la couronne extérieure (pneu, bord de jante) est la plus mince. Les flancs
    // sont des cercles : dès qu'on s'écarte de l'axe la largeur mesurée augmente franchement
    // (2·R·sin de l'écart), ce qui donne un minimum net, insensible à la répartition des sommets.
    const crown = [];
    for (const l of tyre) for (let k = 0; k < l.length; k += 3) { const q = inWheel(w, l[k], l[k + 1], l[k + 2]); if (Math.hypot(q[1], q[2]) > 0.75 * w.r) crown.push(l[k], l[k + 1], l[k + 2]); }
    const widthAlong = (s, t) => { const l = Math.hypot(1, s, t); let lo = 1e9, hi = -1e9; for (let k = 0; k < crown.length; k += 3) { const d = crown[k] + s * crown[k + 1] + t * crown[k + 2]; if (d < lo) lo = d; if (d > hi) hi = d; } return (hi - lo) / l; };
    let bs = w.axis[1] / w.axis[0], bt = w.axis[2] / w.axis[0], best = widthAlong(bs, bt);
    // premier tour : recherche large (jusqu'à 40°, roues braquées), puis pas divisé par deux jusqu'à 0,001°
    if (it === 0) for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) { const s = Math.tan((i * 5 * Math.PI) / 180), t = Math.tan((j * 5 * Math.PI) / 180), v = widthAlong(s, t); if (v < best - 1e-9) { best = v; bs = s; bt = t; } }
    for (let step = it === 0 ? 0.05 : 0.01; step > 2e-5; step /= 2) {
      for (let moved = true, n = 0; moved && n < 8; n++) { moved = false; for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const v = widthAlong(bs + i * step, bt + j * step); if (v < best - 1e-9) { best = v; bs += i * step; bt += j * step; moved = true; break; } } }
    }
    let v = unit([1, bs, bt]);
    if (Math.acos(Math.min(1, v[0])) < 0.001) v = [1, 0, 0]; // moins de 0,06° : la roue est droite
    setFrame(w, v, w.c);
    // Centre : cercle des moindres carrés sur la bande de roulement (les sommets les plus éloignés de l'axe).
    let rmax = 0; for (let k = 0; k < crown.length; k += 3) { const q = inWheel(w, crown[k], crown[k + 1], crown[k + 2]); rmax = Math.max(rmax, Math.hypot(q[1], q[2])); }
    const pts = []; for (let k = 0; k < crown.length; k += 3) { const q = inWheel(w, crown[k], crown[k + 1], crown[k + 2]); if (Math.hypot(q[1], q[2]) > 0.97 * rmax) pts.push(q); }
    const my = pts.reduce((s, q) => s + q[1], 0) / pts.length, mz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
    let syy = 0, szz = 0, syz = 0, sy3 = 0, sz3 = 0;
    for (const q of pts) { const y = q[1] - my, z = q[2] - mz, d = y * y + z * z; syy += y * y; szz += z * z; syz += y * z; sy3 += y * d; sz3 += z * d; }
    const det = 2 * (syy * szz - syz * syz), dy = my + (sy3 * szz - sz3 * syz) / det, dz = mz + (sz3 * syy - sy3 * syz) / det;
    setFrame(w, v, [0, 1, 2].map((a) => w.c[a] + dy * w.up[a] + dz * w.fwd[a]));
    w.tr = 0; w.alo = 1e9; w.ahi = -1e9; // rayon réel du pneu et étendue le long de l'axe
    for (const l of tyre) for (let k = 0; k < l.length; k += 3) { const q = inWheel(w, l[k], l[k + 1], l[k + 2]); w.tr = Math.max(w.tr, Math.hypot(q[1], q[2])); w.alo = Math.min(w.alo, q[0]); w.ahi = Math.max(w.ahi, q[0]); }
  }
  w.tilt = (Math.acos(Math.min(1, w.axis[0])) * 180) / Math.PI;
}
// À quelle roue appartient chaque composante ? (entièrement dans le cylindre du pneu, élargi vers l'intérieur)
const wheelOf = new Map();
for (const [root, c] of comps) if (c.flat) wheelOf.set(root, -2);
for (const [root, l] of near) {
  for (let k = 0; k < 4; k++) {
    const w = wheels[k], width = w.ahi - w.alo;
    const inner = cfg.wheelInner ?? 0.45, outer = 0.08;
    const alo = w.alo - (w.side > 0 ? inner : outer) * width, ahi = w.ahi + (w.side < 0 ? inner : outer) * width;
    let ok = l.length > 0;
    for (let v = 0; v < l.length && ok; v += 3) { const q = inWheel(w, l[v], l[v + 1], l[v + 2]); ok = q[0] >= alo && q[0] <= ahi && Math.hypot(q[1], q[2]) <= w.tr * 1.03; }
    if (ok) { wheelOf.set(root, k); break; }
  }
}
// ——— Pièces fixes prises dans la roue : étriers de frein, bouts de suspension ———
// Tout ce qui est dans la roue modèle tourne avec elle dans le jeu. Une pièce nettement désaxée,
// assez grande, et qui ne se répète pas autour de l'axe (contrairement aux écrous ou aux rayons)
// ne tourne pas en vrai : on la retire, avec les petites pièces posées dessus (vis, logo).
// Mesures dans le repère de la roue, en rayons de pneu.
for (let k = 0; k < 4; k++) {
  const w = wheels[k], list = [];
  for (const [root, l] of near) {
    if (wheelOf.get(root) !== k) continue;
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let rmin = 1e9, rmax = 0;
    for (let v = 0; v < l.length; v += 3) { const q = inWheel(w, l[v], l[v + 1], l[v + 2]); const r = Math.hypot(q[1], q[2]) / w.tr; rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a] / w.tr); hi[a] = Math.max(hi[a], q[a] / w.tr); } }
    const mid = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    list.push({ root, tris: comps.get(root).tris, lo, hi, mid, rmin, rmax, off: Math.hypot(mid[1], mid[2]), size: Math.max(hi[1] - lo[1], hi[2] - lo[2]) });
  }
  for (const p of list) {
    // répétée autour de l'axe ? mêmes dimensions à la même distance, réparties tout autour
    const same = list.filter((o) => Math.abs(o.tris - p.tris) <= 0.03 * p.tris && Math.abs(o.off - p.off) < 0.03 && Math.abs(o.size - p.size) < 0.08 && Math.abs(o.mid[0] - p.mid[0]) < 0.05);
    p.repeated = same.length > 1 && Math.hypot(same.reduce((s, o) => s + o.mid[1] / o.off, 0), same.reduce((s, o) => s + o.mid[2] / o.off, 0)) / same.length < 0.25;
    p.loose = p.off > 0.1 && !p.repeated;
    // … ou isolée et derrière le flanc intérieur du pneu : c'est de la suspension
    p.fixed = p.loose && (p.size >= 0.3 || -w.side * p.mid[0] > Math.max(-w.alo, w.ahi) / w.tr);
    // … ou grande et nettement plus haute que large (ou l'inverse) : ce n'est pas une pièce de révolution
    const dy = p.hi[1] - p.lo[1], dz = p.hi[2] - p.lo[2];
    if (!p.repeated && p.size >= 0.3 && Math.min(dy, dz) < 0.85 * Math.max(dy, dz) && !w.roots.includes(p.root)) p.fixed = true;
  }
  if (!cfg.keepCalipers) {
    const big = list.filter((p) => p.fixed);
    for (const p of list) if (p.loose && !p.fixed && big.some((o) => [0, 1, 2].every((a) => p.mid[a] > o.lo[a] - 0.06 && p.mid[a] < o.hi[a] + 0.06))) p.fixed = true;
    for (const p of list) if (p.fixed) wheelOf.set(p.root, -3);
  }
  w.parts = list;
  if (process.env.DEBUG_WHEELS) {
    log(`  roue ${k} côté ${w.side} z ${w.cz.toFixed(2)} inclinaison ${w.tilt.toFixed(2)}° axe ${w.axis.map((x) => x.toFixed(4))} rayon boîte ${w.r.toFixed(4)} réel ${w.tr.toFixed(4)} décalage centre ${Math.hypot(w.c[1] - w.cy, w.c[2] - w.cz).toFixed(4)}`);
    for (const p of list) log(`    pièce ${String(p.tris).padStart(6)} tri  rayon ${p.rmin.toFixed(2)}–${p.rmax.toFixed(2)}  axe ${p.lo[0].toFixed(2)}…${p.hi[0].toFixed(2)}  désaxée ${p.off.toFixed(3)}  taille ${(p.hi[1] - p.lo[1]).toFixed(2)}×${(p.hi[2] - p.lo[2]).toFixed(2)}${p.repeated ? '  répétée' : ''}${p.fixed ? '  FIXE (retirée)' : p.loose ? '  isolée' : ''}`);
  }
}
const frontZ = Math.max(...wheels.map((w) => w.cz)), rearZ = Math.min(...wheels.map((w) => w.cz));
const isFront = (w) => Math.abs(w.cz - frontZ) < Math.abs(w.cz - rearZ);
// Roue modèle : à l'avant, celle qui a le plus de triangles.
const wheelTris = [0, 0, 0, 0];
for (const [root, c] of comps) { const k = wheelOf.get(root); if (k >= 0) wheelTris[k] += c.tris; }
let tpl = -1; for (let k = 0; k < 4; k++) if (isFront(wheels[k]) && (tpl < 0 || wheelTris[k] > wheelTris[tpl])) tpl = k;
if (cfg.wheelTemplate === 'rear' || wheels[tpl].turned) { tpl = -1; for (let k = 0; k < 4; k++) if (!isFront(wheels[k]) && (tpl < 0 || wheelTris[k] > wheelTris[tpl])) tpl = k; }

// Composantes qui ne sont que du pneu : simplifiées à part, pour qu'il reste bien rond.
const tyreRoots = new Set(wheels[tpl].parts.filter((p) => wheels[tpl].roots.includes(p.root) && p.rmin > 0.5 && p.rmax > 0.97).map((p) => p.root));

// Échelle : vraie longueur de la voiture.
const bodyZ = [1e9, -1e9];
for (const [root, c] of comps) if (wheelOf.get(root) === undefined) { bodyZ[0] = Math.min(bodyZ[0], c.lo[2]); bodyZ[1] = Math.max(bodyZ[1], c.hi[2]); }
const scale = cfg.length ? cfg.length / (bodyZ[1] - bodyZ[0]) : (cfg.scale ?? 1);
const origin = [midX, ground, (frontZ + rearZ) / 2];

// ───────────────────────── Découpe en pièces et familles ─────────────────────────
/** groupes : clé = pièce|famille|matériau → sommets et triangles */
const groups = new Map();
for (const p of live) {
  const role = roles[p.mat];
  const sel = { body: [], wheel: [], tyre: [] };
  for (let k = 0; k < p.idx.length; k += 3) {
    const root = find(p.gid[p.idx[k]]), w = wheelOf.get(root);
    if (w === undefined) sel.body.push(p.idx[k], p.idx[k + 1], p.idx[k + 2]);
    else if (w === tpl) sel[tyreRoots.has(root) ? 'tyre' : 'wheel'].push(p.idx[k], p.idx[k + 1], p.idx[k + 2]);
  }
  for (const what of ['body', 'wheel', 'tyre']) {
    if (!sel[what].length) continue;
    const part = what === 'body' ? 'body' : 'wheel';
    // Dans la roue : pas de peinture ni de feux, tout est « solide ».
    let bucket = role.bucket;
    if (part === 'wheel' && !bucket.startsWith('tex:') && !['matte', 'metal', 'chrome'].includes(bucket)) bucket = role.metal >= 0.5 ? (role.rough < 0.3 ? 'chrome' : 'metal') : 'matte';
    const key = what + '|' + bucket + '|' + p.mat;
    let gr = groups.get(key); if (!gr) groups.set(key, (gr = { part, tyre: what === 'tyre', bucket, mat: p.mat, pos: [], nor: [], uv: [], idx: [], count: 0 }));
    const idx = Uint32Array.from(sel[what], (v) => v + gr.count);
    gr.pos.push(p.pos); gr.nor.push(p.nor); gr.uv.push(p.uv); gr.idx.push(idx); gr.count += p.pos.length / 3;
  }
}
const cat = (list, T) => { const n = list.reduce((s, a) => s + a.length, 0); const o = new T(n); let off = 0; for (const a of list) { o.set(a, off); off += a.length; } return o; };
const meshes = [];
for (const gr of groups.values()) {
  const m = { part: gr.part, tyre: gr.tyre, bucket: gr.bucket, mat: gr.mat, pos: cat(gr.pos, Float32Array), nor: cat(gr.nor, Float32Array), uv: cat(gr.uv, Float32Array), idx: cat(gr.idx, Uint32Array) };
  if (gr.part === 'wheel') {
    // Les tableaux de sommets sont partagés avec la carrosserie : on ne garde que ceux de la roue
    // (sinon la simplification mesure son erreur à l'échelle de la voiture entière).
    const remap = new Int32Array(m.pos.length / 3).fill(-1); let c = 0;
    for (let k = 0; k < m.idx.length; k++) { const v = m.idx[k]; if (remap[v] < 0) remap[v] = c++; m.idx[k] = remap[v]; }
    const pos = new Float32Array(c * 3), nor = new Float32Array(c * 3), uv = new Float32Array(c * 2);
    // Roue modèle redressée : exprimée dans son propre repère, l'axe réel du pneu devient X et
    // son centre l'origine. Sans cela une roue qui a du carrossage « voile » en tournant dans le jeu.
    const w = wheels[tpl], d0 = [w.c[0] - w.cx, w.c[1] - w.cy, w.c[2] - w.cz], x0 = dot(d0, w.axis);
    for (let v = 0; v < remap.length; v++) {
      const r = remap[v]; if (r < 0) continue;
      const q = inWheel(w, m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      pos[r * 3] = (q[0] + x0) * scale; pos[r * 3 + 1] = q[1] * scale; pos[r * 3 + 2] = q[2] * scale; // x = 0 : milieu du pneu, comme avant
      nor[r * 3] = dot([m.nor[v * 3], m.nor[v * 3 + 1], m.nor[v * 3 + 2]], w.axis); nor[r * 3 + 1] = dot([m.nor[v * 3], m.nor[v * 3 + 1], m.nor[v * 3 + 2]], w.up); nor[r * 3 + 2] = dot([m.nor[v * 3], m.nor[v * 3 + 1], m.nor[v * 3 + 2]], w.fwd);
      uv[r * 2] = m.uv[v * 2]; uv[r * 2 + 1] = m.uv[v * 2 + 1];
    }
    m.pos = pos; m.nor = nor; m.uv = uv;
  } else for (let k = 0; k < m.pos.length; k += 3) { m.pos[k] = (m.pos[k] - origin[0]) * scale; m.pos[k + 1] = (m.pos[k + 1] - origin[1]) * scale; m.pos[k + 2] = (m.pos[k + 2] - origin[2]) * scale; }
  meshes.push(m);
}

// Couleurs par sommet (familles sans texture) : couleur du matériau, ou texture cuite.
async function colorsOf(m) {
  const role = roles[m.mat]; const n = m.pos.length / 3; const col = new Float32Array(n * 4);
  const useEmissive = m.bucket === 'emit' || m.bucket === 'tail' || m.bucket === 'head';
  let base = role.color;
  let tex = role.texIndex !== undefined ? await texture(role.texIndex) : null;
  let factor = (g.materials[m.mat].pbrMetallicRoughness?.baseColorFactor) ?? [1, 1, 1, 1];
  if (useEmissive && role.emissive.some((v) => v > 0.05)) {
    factor = [...role.emissive.map((v) => Math.min(v, 1)), 1]; base = factor;
    tex = role.emissiveTex !== undefined ? await texture(role.emissiveTex) : null;
  }
  for (let v = 0; v < n; v++) {
    if (tex && tex.std > 0.02) {
      const u = m.uv[v * 2] - Math.floor(m.uv[v * 2]), w = m.uv[v * 2 + 1] - Math.floor(m.uv[v * 2 + 1]);
      const p = (Math.min(tex.h - 1, Math.floor(w * tex.h)) * tex.w + Math.min(tex.w - 1, Math.floor(u * tex.w))) * 4;
      col[v * 4] = factor[0] * lin(tex.data[p] / 255); col[v * 4 + 1] = factor[1] * lin(tex.data[p + 1] / 255); col[v * 4 + 2] = factor[2] * lin(tex.data[p + 2] / 255); col[v * 4 + 3] = factor[3];
    } else { col[v * 4] = base[0]; col[v * 4 + 1] = base[1]; col[v * 4 + 2] = base[2]; col[v * 4 + 3] = base[3]; }
  }
  return col;
}
for (const m of meshes) m.col = m.bucket.startsWith('tex:') || m.bucket === 'paint' || m.bucket === 'glass' ? null : await colorsOf(m);

// ───────────────────────── Simplification ─────────────────────────
/** Soude les sommets de même position (normale et couleur moyennes) : plus de coutures qui bloquent la simplification. */
function weld(m) {
  const ids = new Map(), remap = new Uint32Array(m.pos.length / 3), pos = [], nor = [], uv = [], col = [], cnt = [];
  for (let v = 0; v < remap.length; v++) {
    const key = Math.round(m.pos[v * 3] * 2e4) + ',' + Math.round(m.pos[v * 3 + 1] * 2e4) + ',' + Math.round(m.pos[v * 3 + 2] * 2e4);
    let r = ids.get(key);
    if (r === undefined) { r = cnt.length; ids.set(key, r); cnt.push(0); pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); nor.push(0, 0, 0); uv.push(m.uv[v * 2], m.uv[v * 2 + 1]); if (m.col) col.push(0, 0, 0, 0); }
    remap[v] = r; cnt[r]++;
    for (let a = 0; a < 3; a++) nor[r * 3 + a] += m.nor[v * 3 + a];
    if (m.col) for (let a = 0; a < 4; a++) col[r * 4 + a] += m.col[v * 4 + a];
  }
  for (let r = 0; r < cnt.length; r++) { const l = Math.hypot(nor[r * 3], nor[r * 3 + 1], nor[r * 3 + 2]) || 1; for (let a = 0; a < 3; a++) nor[r * 3 + a] /= l; if (m.col) for (let a = 0; a < 4; a++) col[r * 4 + a] /= cnt[r]; }
  const idx = [];
  for (let k = 0; k < m.idx.length; k += 3) { const a = remap[m.idx[k]], b = remap[m.idx[k + 1]], c = remap[m.idx[k + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { ...m, pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), col: m.col ? new Float32Array(col) : null, idx: new Uint32Array(idx) };
}
function simplify(m, ratio) {
  let idx = m.idx;
  const want = Math.max(60, Math.floor((idx.length * ratio) / 3) * 3);
  if (ratio < 0.98 && idx.length > want) {
    const textured = m.bucket.startsWith('tex:');
    const stride = textured ? 5 : 3;
    const attrOf = (m) => { const attr = new Float32Array((m.pos.length / 3) * stride); for (let v = 0; v < m.pos.length / 3; v++) { attr[v * stride] = m.nor[v * 3]; attr[v * stride + 1] = m.nor[v * 3 + 1]; attr[v * stride + 2] = m.nor[v * 3 + 2]; if (textured) { attr[v * stride + 3] = m.uv[v * 2]; attr[v * stride + 4] = m.uv[v * 2 + 1]; } } return attr; };
    let attr = attrOf(m);
    // Pneu : la forme (le rond) compte plus que les normales.
    const weights = textured ? [m.tyre ? 0.15 : 0.5, m.tyre ? 0.15 : 0.5, m.tyre ? 0.15 : 0.5, 1.5, 1.5] : m.tyre ? [0.15, 0.15, 0.15] : [0.6, 0.6, 0.6];
    let res = MeshoptSimplifier.simplifyWithAttributes(idx, m.pos, 3, attr, stride, weights, null, want, 0.04, ['Prune'])[0];
    if (m.part === 'wheel') {
      // Roue : elle tourne, la moindre bosse se voit. Pas de simplification grossière : si les coutures
      // (arêtes vives, facettes) bloquent, on soude les sommets et on recommence, avec une erreur bornée.
      if (res.length > want * 1.3 && !textured) {
        m = weld(m); attr = attrOf(m);
        res = MeshoptSimplifier.simplifyWithAttributes(m.idx, m.pos, 3, attr, stride, weights, null, want, 0.04, ['Prune'])[0];
      }
      if (res.length > want * 1.6) res = MeshoptSimplifier.simplifyWithAttributes(res, m.pos, 3, attr, stride, weights, null, want, 0.09, ['Prune'])[0];
      return { ...m, idx: res };
    }
    // Beaucoup de petites pièces détachées : on accepte plus d'erreur plutôt que de garder trop de triangles.
    if (res.length > want * 1.6) res = MeshoptSimplifier.simplifyWithAttributes(res, m.pos, 3, attr, stride, weights, null, want, 0.25, ['Prune'])[0];
    if (res.length > want * 2.5 && !textured) res = MeshoptSimplifier.simplifySloppy(res, m.pos, 3, null, want, 0.3)[0];
    idx = res;
  }
  return { ...m, idx };
}
/** Fusionne les groupes d'une même famille et compacte les sommets. */
function mergeBuckets(list) {
  const by = new Map();
  for (const m of list) { if (!m.idx.length) continue; const a = by.get(m.bucket) ?? []; a.push(m); by.set(m.bucket, a); }
  const outList = [];
  for (const [bucket, ms] of by) {
    const pos = [], nor = [], uv = [], col = [], idx = []; let n = 0;
    for (const m of ms) {
      const remap = new Int32Array(m.pos.length / 3).fill(-1);
      for (let k = 0; k < m.idx.length; k++) {
        const v = m.idx[k];
        if (remap[v] < 0) { remap[v] = n++; pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); nor.push(m.nor[v * 3], m.nor[v * 3 + 1], m.nor[v * 3 + 2]); uv.push(m.uv[v * 2], m.uv[v * 2 + 1]); if (m.col) col.push(m.col[v * 4], m.col[v * 4 + 1], m.col[v * 4 + 2], m.col[v * 4 + 3]); }
        idx.push(remap[v]);
      }
    }
    outList.push({ bucket, mat: ms[0].mat, pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), col: col.length ? new Float32Array(col) : null, idx: new Uint32Array(idx) });
  }
  return outList;
}
const weight = (m) => (cfg.weights?.[roles[m.mat].name] ?? cfg.weights?.[m.bucket] ?? ({ paint: 3, glass: 2.5, tail: 2, head: 2, lens: 1.5 }[m.bucket] ?? (m.bucket.startsWith('tex:') ? 2 : 1)));
function level(part, target) {
  let ms = meshes.filter((m) => m.part === part);
  const total = ms.reduce((s, m) => s + m.idx.length / 3, 0);
  if (total <= target) return mergeBuckets(ms);
  // Roue : le pneu garde jusqu'à la moitié des triangles. Un pneu lisse a peu de facettes ; trop
  // simplifié il devient bosselé et la roue semble voilée quand elle tourne.
  const tyre = ms.filter((m) => m.tyre);
  if (tyre.length) {
    const n = tyre.reduce((s, m) => s + m.idx.length / 3, 0), share = Math.min(1, ((cfg.tyreShare ?? 0.5) * target) / n);
    const done = tyre.map((m) => (share < 0.98 ? simplify(m, share) : m));
    ms = ms.filter((m) => !m.tyre); target = Math.max(target - done.reduce((s, m) => s + m.idx.length / 3, 0), 0.3 * target);
    if (ms.reduce((s, m) => s + m.idx.length / 3, 0) <= target) return mergeBuckets([...ms, ...done]);
    return mergeBuckets([...levelOf(ms, target), ...done]);
  }
  return mergeBuckets(levelOf(ms, target));
}
function levelOf(ms, target) {
  const weighted = ms.reduce((s, m) => s + (m.idx.length / 3) * weight(m), 0);
  // deux passes : les petits groupes plafonnés à 100 % rendent leur part aux autres
  let k = target / weighted;
  for (let pass = 0; pass < 4; pass++) { const got = ms.reduce((s, m) => s + (m.idx.length / 3) * Math.min(1, k * weight(m)), 0); k *= target / got; }
  return ms.map((m) => (m.idx.length < 1800 ? m : simplify(m, Math.min(1, k * weight(m)))));
}
const parts = {
  body: level('body', cfg.target ?? 70000),
  body_lod1: level('body', cfg.targetLod1 ?? 20000),
  wheel: level('wheel', cfg.wheelTarget ?? 3200),
  wheel_lod1: level('wheel', cfg.wheelTargetLod1 ?? 900),
};

// ───────────────────────── Écriture du GLB ─────────────────────────
const buffers = []; let length = 0;
const views = [], accessors = [], images = [], textures = [], materials = [], gm = [], nodes = [];
function view(data, target) { const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength); const pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: length, byteLength: b.length, ...(target ? { target } : {}) }); buffers.push(b, Buffer.alloc(pad)); length += b.length + pad; return views.length - 1; }
function accessor(data, type, comp, opts = {}) {
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
  const a = { bufferView: view(data, type === 'SCALAR' ? 34963 : 34962), componentType: comp, count: data.length / n, type, ...(opts.normalized ? { normalized: true } : {}) };
  if (opts.minmax) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let k = 0; k < data.length; k++) { lo[k % 3] = Math.min(lo[k % 3], data[k]); hi[k % 3] = Math.max(hi[k % 3], data[k]); } a.min = lo; a.max = hi; }
  accessors.push(a); return accessors.length - 1;
}
const matIndex = new Map();
async function material(bucket, mat) {
  if (matIndex.has(bucket)) return matIndex.get(bucket);
  const role = roles[mat]; const m = { name: bucket, pbrMetallicRoughness: {} };
  if (bucket === 'paint') m.pbrMetallicRoughness = { baseColorFactor: [...role.color.slice(0, 3), 1], metallicFactor: 0.5, roughnessFactor: 0.3 };
  else if (bucket === 'glass') { m.pbrMetallicRoughness = { baseColorFactor: [0.02, 0.03, 0.04, 0.5], metallicFactor: 0.6, roughnessFactor: 0.06 }; m.alphaMode = 'BLEND'; }
  else if (bucket === 'lens') { m.pbrMetallicRoughness = { metallicFactor: 0.2, roughnessFactor: 0.1 }; m.alphaMode = 'BLEND'; }
  else if (bucket.startsWith('tex:')) {
    const t = role.tex; const big = role.tris > 2000 ? (cfg.texSize ?? 1024) : role.tris > 200 ? 512 : 256;
    const meta = await sharp(t.file).metadata();
    const alpha = meta.hasAlpha && (role.mask || g.materials[mat].alphaMode === 'BLEND');
    const img = sharp(t.file).resize(big, big, { fit: 'inside', withoutEnlargement: true });
    const buf = alpha ? await img.png({ compressionLevel: 9, palette: true }).toBuffer() : await img.flatten({ background: '#000' }).jpeg({ quality: 84 }).toBuffer();
    images.push({ bufferView: view(new Uint8Array(buf)), mimeType: alpha ? 'image/png' : 'image/jpeg' });
    textures.push({ source: images.length - 1, sampler: 0 });
    const f = g.materials[mat].pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    m.pbrMetallicRoughness = { baseColorFactor: f, baseColorTexture: { index: textures.length - 1 }, metallicFactor: Math.min(role.metal, 0.9), roughnessFactor: Math.max(role.rough, 0.25) };
    if (role.mask) { m.alphaMode = 'MASK'; m.alphaCutoff = g.materials[mat].alphaCutoff ?? 0.5; }
    if (role.doubleSided) m.doubleSided = true;
  } else m.pbrMetallicRoughness = { metallicFactor: bucket === 'matte' ? 0 : 1, roughnessFactor: bucket === 'chrome' ? 0.12 : bucket === 'metal' ? 0.42 : 0.62 };
  materials.push(m); matIndex.set(bucket, materials.length - 1); return materials.length - 1;
}
const stats = {}; const draws = {};
for (const [name, list] of Object.entries(parts)) {
  const primsOut = []; let tri = 0;
  for (const m of list.sort((a, b) => a.bucket.localeCompare(b.bucket))) {
    tri += m.idx.length / 3;
    const attributes = { POSITION: accessor(m.pos, 'VEC3', 5126, { minmax: true }), NORMAL: accessor(m.nor, 'VEC3', 5126) };
    if (m.bucket.startsWith('tex:')) attributes.TEXCOORD_0 = accessor(m.uv, 'VEC2', 5126);
    if (m.col) attributes.COLOR_0 = accessor(Uint8Array.from(m.col, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)), 'VEC4', 5121, { normalized: true });
    const small = m.pos.length / 3 < 65536;
    primsOut.push({ attributes, indices: accessor(small ? Uint16Array.from(m.idx) : m.idx, 'SCALAR', small ? 5123 : 5125), material: await material(m.bucket, m.mat) });
  }
  gm.push({ name, primitives: primsOut }); nodes.push({ name, mesh: gm.length - 1 }); stats[name] = tri; draws[name] = primsOut.length;
}
const r3 = (v) => +v.toFixed(3);
const bb = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] };
for (const m of parts.body) for (let k = 0; k < m.pos.length; k++) { bb.lo[k % 3] = Math.min(bb.lo[k % 3], m.pos[k]); bb.hi[k % 3] = Math.max(bb.hi[k % 3], m.pos[k]); }
const fw = wheels.filter(isFront), rw = wheels.filter((w) => !isFront(w));
const avg = (l, f) => l.reduce((s, w) => s + f(w), 0) / l.length;
const paintRole = roles.find((r) => r.role === 'paint');
const extras = {
  id, credit: cfg.credit,
  wheelSide: wheels[tpl].side,
  wheelRadius: r3(wheels[tpl].tr * scale),
  axleFrontZ: r3((frontZ - origin[2]) * scale), axleRearZ: r3((rearZ - origin[2]) * scale),
  halfTrackFront: r3(avg(fw, (w) => Math.abs(w.cx - midX)) * scale), halfTrackRear: r3(avg(rw, (w) => Math.abs(w.cx - midX)) * scale),
  radiusFront: r3(avg(fw, (w) => w.tr) * scale), radiusRear: r3(avg(rw, (w) => w.tr) * scale),
  paint: paintRole ? paintRole.color.slice(0, 3).map(r3) : null,
  min: bb.lo.map(r3), max: bb.hi.map(r3), triangles: stats, draws,
};
const json = { asset: { version: '2.0', generator: 'jeu-course-tokyo convert-car', copyright: cfg.credit }, scene: 0, scenes: [{ nodes: nodes.map((_, k) => k), extras }], nodes, meshes: gm, materials, accessors, bufferViews: views, buffers: [{ byteLength: length }], ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987 }] } : {}) };
let jb = Buffer.from(JSON.stringify(json)); jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
const body2 = Buffer.concat(buffers); const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + body2.length, 8);
const h1 = Buffer.alloc(8); h1.writeUInt32LE(jb.length, 0); h1.writeUInt32LE(0x4e4f534a, 4); const h2 = Buffer.alloc(8); h2.writeUInt32LE(body2.length, 0); h2.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.concat([head, h1, jb, h2, body2]));

log(`${id} : ${(fs.statSync(out).size / 1e6).toFixed(2)} Mo — taille ${r3(bb.hi[0] - bb.lo[0])} × ${r3(bb.hi[1] - bb.lo[1])} × ${r3(bb.hi[2] - bb.lo[2])} m, échelle ${scale.toFixed(4)}`);
log(`  roues : rayon av ${extras.radiusFront} ar ${extras.radiusRear}, voie ${extras.halfTrackFront}/${extras.halfTrackRear}, essieux ${extras.axleFrontZ}/${extras.axleRearZ}, triangles par roue ${wheelTris.join('/')}`);
for (const [n, l] of Object.entries(parts)) log(`  ${n} (${stats[n]}) : ` + l.map((m) => `${m.bucket}:${m.idx.length / 3}`).join(' '));
if (process.env.ROLES) for (const r of roles) if (r.tris) log(`    ${r.bucket.padEnd(18)} ${String(r.tris).padStart(7)} ${r.name}`);
