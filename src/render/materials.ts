import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  dot,
  exp,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  mx_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  reflector,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Matériaux de la ville, écrits en TSL (fonctionnent en WebGPU et en WebGL2).
 * Aucune texture : fenêtres, enseignes et marquages sont calculés dans le shader.
 * Les néons sont des surfaces émissives + bloom, pas de vraies lumières.
 */

type N = ReturnType<typeof float>;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Les types TSL sont très génériques ; on reste volontairement souple ici.
const hash1 = (x: any): N => fract(sin(x.mul(12.9898).add(1.37)).mul(43758.5453)) as N;
const hash2 = (x: any, y: any): N => fract(sin(x.mul(12.9898).add(y.mul(78.233))).mul(43758.5453)) as N;

const MAGENTA = vec3(1.0, 0.08, 0.55);
const CYAN = vec3(0.05, 0.75, 1.0);
const AMBER = vec3(1.0, 0.5, 0.1);

/** Couleur néon à partir d'un nombre aléatoire 0..1. */
const neonFrom = (h: any) => mix(mix(MAGENTA, CYAN, smoothstep(0.34, 0.4, h)), AMBER, smoothstep(0.72, 0.78, h));

export interface RenderTuning {
  /** Intensité générale des néons et fenêtres. */
  neon: ReturnType<typeof uniform>;
  /** Force des reflets sur la chaussée mouillée. */
  wetness: ReturnType<typeof uniform>;
}

export interface CityMaterials {
  building: THREE.Material;
  road: THREE.Material;
  highwayRoad: THREE.Material;
  /** Bretelles : posées sur une autre chaussée, donc dessinées avec un léger décalage de profondeur. */
  connectorRoad: THREE.Material;
  solid: THREE.Material;
  glow: THREE.Material;
  pool: THREE.Material;
  ground: THREE.Material;
  sky: THREE.Material;
  /** Objet à ajouter à la scène : plan du miroir de la chaussée. */
  reflectorTarget: THREE.Object3D;
  tuning: RenderTuning;
}

export const SKY_HORIZON = new THREE.Color(0.05, 0.022, 0.085);
export const SKY_ZENITH = new THREE.Color(0.008, 0.012, 0.035);

export function createCityMaterials(quality: { reflections: boolean; reflectionScale: number }): CityMaterials {
  const tuning: RenderTuning = { neon: uniform(1.0), wetness: uniform(1.0) };
  const neonU = tuning.neon as unknown as N;
  const wetU = tuning.wetness as unknown as N;
  const aData = attribute('aData', 'vec4');
  const vColor = attribute('color', 'vec3');

  // ————————————————————————————————————————————————————————————————
  // Immeubles : fenêtres éclairées, vitrines et rideaux de fer au rez-de-chaussée,
  // halo coloré des néons sur le bas des murs.
  // aData = (graine, largeur de cellule, part allumée, style [+10 décor lointain, 20 = toit technique])
  // ————————————————————————————————————————————————————————————————
  const building = new THREE.MeshStandardNodeMaterial();
  {
    // La graine est un entier ; on l'arrondit car l'interpolation peut la faire varier d'un cheveu.
    const seed = floor(aData.x.add(0.5));
    const cellW = aData.y;
    const lit = aData.z;
    const styleRaw = aData.w;
    const isRoofBox = step(19.5, styleRaw);
    const isBackdrop = step(9.5, styleRaw).mul(float(1).sub(isRoofBox));
    const style = styleRaw.sub(isBackdrop.mul(10));
    const isGlass = step(1.5, style).mul(float(1).sub(isRoofBox));
    const isHome = step(0.5, style).mul(float(1).sub(step(1.5, style)));

    const p = positionLocal;
    const n = normalLocal;
    const isWall = float(1).sub(step(0.5, abs(n.y))).mul(float(1).sub(isRoofBox));
    // Coordonnée le long de la façade, en mètres (les immeubles peuvent être tournés dans tous les sens).
    const along = uv().x;
    const cu = along.div(cellW).add(seed.mul(0.25));
    const cv = p.y.div(3.4);
    const cx = floor(cu);
    const cy = floor(cv);
    const fx = fract(cu);
    const fy = fract(cv);

    const mx = mix(mix(float(0.14), float(0.22), isHome), float(0.04), isGlass);
    const my = mix(mix(float(0.22), float(0.3), isHome), float(0.06), isGlass);
    const inWindow = step(mx, fx).mul(step(fx, float(1).sub(mx))).mul(step(my, fy)).mul(step(fy, float(1).sub(my.mul(0.6))));

    const h = hash2(cx.add(seed.mul(0.61)), cy.add(seed.mul(0.17)));
    const h2 = hash2(cy.add(seed.mul(0.43)), cx.mul(1.37).add(seed.mul(0.29)));
    const floorHash = hash1(cy.add(seed.mul(0.77)));
    // Bureaux : certains étages entièrement allumés. Résidentiel : fenêtres isolées.
    const floorLit = step(floorHash, float(0.07)).mul(float(1).sub(isHome));
    const on = max(step(h, lit), floorLit);
    const warm = vec3(1.0, 0.7, 0.38);
    const cool = vec3(0.6, 0.8, 1.0);
    const tv = vec3(0.35, 0.5, 1.0);
    const coolBias = mix(mix(float(0.45), float(0.15), isHome), float(0.75), isGlass);
    let winColor = mix(warm, cool, step(h2, coolBias));
    winColor = mix(winColor, tv, step(0.93, h2).mul(isHome));
    const bright = mix(float(0.08), float(0.7), hash1(h.mul(91.7).add(h2)).pow(1.6));
    // Plafonnier : plus clair en haut de la fenêtre ; meneau central sur les logements.
    const shade = mix(float(0.45), float(1.0), smoothstep(0.2, 0.95, fy)).mul(float(1).sub(step(abs(fx.sub(0.5)), float(0.025)).mul(isHome).mul(0.8)));
    // Store à moitié baissé sur certaines fenêtres
    const blind = mix(float(1), step(fy, float(0.55)), step(0.7, hash1(h.mul(37.0))));
    const upper = step(3.4, p.y); // au-dessus du rez-de-chaussée
    const windowLight = winColor.mul(bright).mul(shade).mul(on).mul(blind).mul(inWindow).mul(isWall).mul(upper);

    // Rez-de-chaussée : vitrines éclairées ou rideaux de fer
    const shopCell = floor(along.div(5.2).add(seed.mul(0.5)));
    const shopF = fract(along.div(5.2).add(seed.mul(0.5)));
    const shopHash = hash1(shopCell.add(seed.mul(0.31)));
    const isGround = float(1).sub(upper).mul(isWall).mul(float(1).sub(isBackdrop));
    const shopOpen = step(shopHash, float(0.42));
    const inShop = step(0.06, shopF).mul(step(shopF, float(0.94))).mul(step(0.15, p.y)).mul(step(p.y, float(2.9)));
    const shopTint = mix(vec3(1.0, 0.85, 0.65), neonFrom(hash1(shopHash.mul(53.0))), step(0.6, hash1(shopHash.mul(17.0))).mul(0.6));
    // Vitrine : montants verticaux, soubassement sombre, lumière plus forte en haut.
    const shopFrame = step(0.07, fract(shopF.mul(4.0))).mul(smoothstep(0.3, 1.1, p.y).mul(0.6).add(0.4));
    const shopLight = shopTint.mul(0.5).mul(shopFrame).mul(shopOpen).mul(inShop).mul(isGround);
    const ribs = step(0.5, fract(p.y.mul(7.0))).mul(0.035).add(0.1);
    const shutter = vec3(ribs, ribs, ribs.mul(1.08)).mul(float(1).sub(shopOpen)).mul(inShop).mul(isGround);

    // Halo des néons sur le bas des murs (teinte qui change tous les ~20 m)
    const zone = hash2(floor(positionWorld.x.div(21.0)), floor(positionWorld.z.div(21.0)));
    const zone2 = hash2(floor(positionWorld.x.div(13.0).add(4.3)), floor(positionWorld.z.div(13.0).add(1.7)));
    const wash = mix(neonFrom(zone), neonFrom(zone2), 0.35)
      .mul(exp(p.y.mul(-0.16)))
      .mul(0.075)
      .mul(isWall)
      .mul(float(1).sub(isBackdrop.mul(0.7)));

    const glassDark = vec3(0.012, 0.016, 0.03);
    const wall = vColor.mul(mix(float(0.9), float(1.1), hash1(cy.add(seed.mul(0.13)))));
    const isWinArea = inWindow.mul(isWall).mul(upper);
    const baseColor = mix(wall, glassDark, isWinArea);
    building.colorNode = mix(baseColor, baseColor.add(shutter), isGround);
    building.emissiveNode = windowLight.add(shopLight).mul(neonU).add(wash.mul(neonU));
    building.roughnessNode = mix(float(0.85), float(0.18), isWinArea);
    building.metalnessNode = float(0);
  }

  // ————————————————————————————————————————————————————————————————
  // Surfaces lumineuses : enseignes, écrans, têtes de lampadaires, balises.
  // aData = (graine, type, largeur de face, hauteur | intensité)
  //   type 0 = enseigne à glyphes, 1 = écran animé, 2 = tube néon, 3 = uni (aData.w = intensité),
  //   4 = distributeur, 5 = balise clignotante
  // ————————————————————————————————————————————————————————————————
  const glow = new THREE.MeshBasicNodeMaterial();
  {
    const seed = floor(aData.x.add(0.5));
    const type = aData.y;
    const faceW = aData.z;
    const faceH = aData.w;
    const st = uv();
    const is = (k: number) => step(k - 0.5, type).mul(step(type, k + 0.5));

    // — Type 0 : pseudo-caractères. Une case carrée par caractère, motif 5×5 symétrique. —
    const cell = max(min(faceW, faceH).mul(0.86), 0.4);
    const gu = st.x.div(cell);
    const gv = st.y.div(cell);
    const gcx = floor(gu);
    const gcy = floor(gv);
    const inner = vec2(fract(gu), fract(gv)).sub(0.14).div(0.72);
    const inside = step(0, inner.x).mul(step(inner.x, 1)).mul(step(0, inner.y)).mul(step(inner.y, 1));
    const px = abs(floor(inner.x.mul(5)).sub(2));
    const py = floor(inner.y.mul(5));
    const bit = step(0.42, hash2(px.add(gcx.mul(7.0)).add(seed.mul(0.37)), py.add(gcy.mul(13.0)).add(seed.mul(0.71))));
    const glyph = bit.mul(inside);
    const inverted = step(0.5, hash1(seed.mul(0.41)));
    // Soit glyphes colorés sur fond sombre, soit glyphes blancs sur fond coloré.
    const glyphSign = mix(vColor.mul(glyph.mul(2.3).add(0.06)), mix(vColor.mul(0.8), vec3(1.9, 1.85, 1.8), glyph), inverted);

    // — Type 1 : écran publicitaire, gros pixels qui changent —
    const pxSize = 0.6;
    const sx = floor(st.x.div(pxSize));
    const sy = floor(st.y.div(pxSize));
    const tick = floor(time.mul(0.6).add(seed.mul(0.1)));
    const sweep = sin(st.x.mul(0.5).add(st.y.mul(0.35)).add(time.mul(0.8)).add(seed.mul(0.2))).mul(0.5).add(0.5);
    const pix = hash2(sx.add(tick.mul(3.1)), sy.add(seed.mul(0.77)));
    const screenColor = mix(vColor, neonFrom(hash1(tick.add(seed.mul(0.9)))), sweep);
    const screen = screenColor.mul(pix.mul(0.8).add(0.3)).mul(1.0);

    // — Type 2 : tube néon uni, parfois défaillant —
    const flickerOn = step(hash1(seed.mul(0.13)), float(0.12));
    const flick = mix(float(1), step(0.25, hash1(floor(time.mul(14)).add(seed))).mul(0.8).add(0.2), flickerOn);
    const tube = vColor.mul(2.1).mul(flick);

    // — Type 3 : uni —
    const plain = vColor.mul(faceH);

    // — Type 4 : distributeur (rangées de produits) —
    const rows = step(0.25, fract(st.y.mul(2.2))).mul(step(0.12, fract(st.x.mul(4.0))));
    const vending = vColor.mul(rows.mul(1.1).add(0.25));

    // — Type 5 : balise rouge qui clignote lentement —
    const beacon = vColor.mul(smoothstep(0.0, 0.25, sin(time.mul(2.4).add(seed.mul(0.3)))).mul(5).add(0.3));

    const colorOut = glyphSign.mul(is(0)).add(screen.mul(is(1))).add(tube.mul(is(2))).add(plain.mul(is(3))).add(vending.mul(is(4))).add(beacon.mul(is(5)));
    glow.colorNode = colorOut.mul(neonU);
    glow.side = THREE.DoubleSide;
  }

  // ————————————————————————————————————————————————————————————————
  // Chaussée mouillée : asphalte, marquages, flaques, reflets (miroir plan).
  // uv = (position en travers, distance le long), aData = (type, longueur, demi-largeur, -)
  // ————————————————————————————————————————————————————————————————
  // Un seul miroir pour toutes les chaussées au sol (il coûte un rendu de scène par image).
  const refl = quality.reflections ? reflector({ resolutionScale: quality.reflectionScale, bounces: false }) : null;
  const reflectorTarget: THREE.Object3D = refl ? refl.target : new THREE.Object3D();
  if (refl) refl.target.rotateX(-Math.PI / 2);
  const makeRoad = (withReflection: boolean): THREE.Material => {
    const m = new THREE.MeshStandardNodeMaterial();
    const kind = aData.x;
    const len = aData.y;
    const half = aData.z;
    const st = uv();
    const u = st.x;
    const v = st.y;
    const au = abs(u);
    const is = (k: number) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
    const band = (center: number | N, width: number) => step(abs(au.sub(center)), float(width / 2));
    const dash = (period: number, fill: number) => step(fract(v.div(period)), float(fill));
    const wp = positionWorld;

    // Marquages
    const edgeLine = band(half.sub(0.45) as N, 0.14);
    const street = band(0, 0.14).mul(dash(7, 0.45));
    const avenue = max(max(band(0.22, 0.13), band(4.0, 0.14).mul(dash(9, 0.4))), edgeLine);
    const boulevard = max(max(band(6.0, 0.16), band(10.5, 0.14).mul(dash(9, 0.4))), edgeLine);
    const highway = max(band(0, 0.14).mul(dash(10, 0.5)), band(half.sub(0.35) as N, 0.16));
    // Autoroute de ceinture : double ligne centrale, trois voies par sens.
    const ringway = max(max(band(0.28, 0.15), max(band(4.3, 0.15), band(8.4, 0.15)).mul(dash(12, 0.42))), band(half.sub(0.45) as N, 0.18));
    const connector = band(half.sub(0.35) as N, 0.15);
    // Passages piétons et ligne d'arrêt près des carrefours
    const dEnd = min(v, len.sub(v));
    const zebra = step(1.0, dEnd).mul(step(dEnd, float(4.2))).mul(step(0.5, fract(u.mul(0.9).add(0.25)))).mul(step(au, half.sub(0.7)));
    const stopLine = step(5.6, dEnd).mul(step(dEnd, float(6.0))).mul(step(au, half.sub(0.7)));
    const crossings = max(zebra, stopLine);
    let paint = street.mul(is(2)).add(avenue.mul(is(3))).add(boulevard.mul(is(4))).add(highway.mul(is(5))).add(ringway.mul(is(6))).add(connector.mul(is(7)));
    paint = max(paint, crossings.mul(is(2).add(is(3)).add(is(4))));
    // Peinture usée
    const wear = mx_noise_float(wp.xz.mul(1.7)).mul(0.5).add(0.5);
    paint = paint.mul(smoothstep(0.15, 0.6, wear).mul(0.75).add(0.25)).clamp(0, 1);

    // Asphalte et flaques
    const grain = mx_noise_float(wp.xz.mul(9.0)).mul(0.5).add(0.5);
    const patches = mx_noise_float(wp.xz.mul(0.35)).mul(0.5).add(0.5);
    const puddle = smoothstep(0.5, 0.78, mx_noise_float(wp.xz.mul(0.11).add(vec2(17.3, 4.1))).mul(0.5).add(0.5).add(patches.mul(0.25)));
    const asphalt = vec3(0.04, 0.042, 0.048).mul(grain.mul(0.5).add(0.75)).mul(patches.mul(0.4).add(0.8));
    const wetDark = mix(float(1), float(0.55), puddle);
    m.colorNode = mix(asphalt.mul(wetDark), vec3(0.62, 0.62, 0.58), paint.mul(0.85));
    m.roughnessNode = mix(mix(float(0.5), float(0.07), puddle), float(0.6), paint);
    m.metalnessNode = float(0);
    // Les reflets viennent du miroir ci-dessous : on coupe la carte d'environnement pour ne pas blanchir la route.
    m.envMapIntensity = 0.12;

    if (withReflection && refl) {
      // Petites ondulations de l'eau : on déforme le miroir, davantage hors des flaques.
      const ripple = vec2(mx_noise_float(wp.xz.mul(7.0)), mx_noise_float(wp.xz.mul(7.0).add(vec2(31.0, 7.0))));
      const mirror = (refl as any).sample((refl.uvNode as any).add(ripple.mul(mix(float(0.012), float(0.003), puddle))));
      const fresnel = float(1).sub(dot(normalView, positionViewDirection).clamp(0, 1)).pow(2.2).mul(0.85).add(0.15);
      const strength = mix(float(0.2), float(0.68), puddle).mul(fresnel).mul(float(1).sub(paint.mul(0.5)));
      m.emissiveNode = mirror.rgb.mul(strength).mul(wetU);
    }
    return m;
  };
  const road = makeRoad(quality.reflections);
  const highwayRoad = makeRoad(false);
  highwayRoad.side = THREE.DoubleSide;
  // Pas de miroir ici : un seul matériau peut lire le miroir, sinon il se lirait lui-même pendant son propre rendu.
  const connectorRoad = makeRoad(false);
  connectorRoad.polygonOffset = true;
  connectorRoad.polygonOffsetFactor = -2;
  connectorRoad.polygonOffsetUnits = -4;

  // ————————————————————————————————————————————————————————————————
  // Trottoirs, poteaux, béton : couleur par sommet, dallage discret, halo des néons au sol.
  // ————————————————————————————————————————————————————————————————
  const makeSolid = (side: THREE.Side): THREE.Material => {
    const solid = new THREE.MeshStandardNodeMaterial();
    const wp = positionWorld;
    const isTop = step(0.5, normalLocal.y).mul(step(wp.y, float(0.3)));
    const tile = max(step(0.96, fract(wp.x.div(1.5))), step(0.96, fract(wp.z.div(1.5)))).mul(isTop);
    const speck = mx_noise_float(wp.xz.mul(4.0)).mul(0.5).add(0.5);
    solid.colorNode = vColor.mul(mix(float(0.85), float(1.15), speck)).mul(float(1).sub(tile.mul(0.45)));
    solid.roughnessNode = mix(float(0.8), float(0.35), isTop.mul(smoothstep(0.4, 0.7, mx_noise_float(wp.xz.mul(0.2)).mul(0.5).add(0.5))));
    solid.metalnessNode = float(0);
    const zone = hash2(floor(wp.x.div(21.0)), floor(wp.z.div(21.0)));
    solid.emissiveNode = neonFrom(zone).mul(0.022).mul(isTop).mul(neonU);
    solid.side = side;
    return solid;
  };
  const solid = makeSolid(THREE.DoubleSide);
  // Le sol n'a qu'une face : vu d'en dessous (par le miroir de la chaussée) il doit rester invisible.
  const ground = makeSolid(THREE.FrontSide);

  // Flaques de lumière sous les lampadaires : plans additifs.
  const pool = new THREE.MeshBasicNodeMaterial();
  {
    const d = uv().sub(0.5).length().mul(2);
    const fall = smoothstep(1.0, 0.0, d);
    pool.colorNode = vColor.mul(fall.mul(fall)).mul(0.16);
    pool.transparent = true;
    pool.blending = THREE.AdditiveBlending;
    pool.depthWrite = false;
    pool.fog = true;
  }

  // Ciel : dégradé du halo urbain (horizon) vers le bleu nuit (zénith).
  const sky = new THREE.MeshBasicNodeMaterial();
  {
    const h = positionLocal.normalize().y.clamp(0, 1);
    const horizon = vec3(SKY_HORIZON.r, SKY_HORIZON.g, SKY_HORIZON.b);
    const zenith = vec3(SKY_ZENITH.r, SKY_ZENITH.g, SKY_ZENITH.b);
    sky.colorNode = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
    sky.side = THREE.BackSide;
    sky.fog = false;
    sky.depthWrite = false;
  }

  return { building, road, highwayRoad, connectorRoad, solid, glow, pool, ground, sky, reflectorTarget, tuning };
}
