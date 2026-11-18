/**
 * Réglages de conversion par voiture (voir convert-car.mjs).
 * - front : direction de l'avant dans le fichier (+z, -z, +x, -x) ;
 * - length : vraie longueur de la voiture (m) ;
 * - paint / tail / head / glass / lens / emit / keepTex / drop : noms de matériaux du fichier.
 */
const sk = (title, author, license, slug) => `« ${title} » par ${author} — ${license} — https://sketchfab.com/3d-models/${slug}`;

export const CARS = {
  'datsun-240k': {
    credit: sk('(FREE) 1972 Datsun 240k GT', 'Karol Miklas', 'CC-BY-SA-4.0', 'free-1972-datsun-240k-gt-b2303a552b444e5b8637fdf5169b41cb'),
    src: 'free_1972_datsun_240k_gt', length: 4.46,
    paint: ['paint'], drop: ['coat', 'Plane.035__0'], tail: ['red_glass'], head: ['headlights'], lens: ['orange_glass'], glass: ['glass'],
  },
  'skyline-2000gtr': { credit: sk('1971 Nissan Skyline 2000 GT-R', 'OUTPISTON', 'CC-BY-NC-SA-4.0', '1971-nissan-skyline-2000-gt-r-d922ecb410764164a5310f6552f80563'), src: '1971_nissan_skyline_2000_gt_r', length: 4.33, paint: ['Vehicle_Exterior_mm_ext'], solid: ['Vehicle_Exterior_mm_wheel'], chrome: ['Vehicle_Exterior_mm_wheel'], bake: ['Vehicle_Exterior_mm_tyre', 'Vehicle_Exterior_mm_rotor'] },
  'datsun-280z': { credit: sk('[FREE] Datsun 280Z', 'Martin Trafas', 'CC-BY-4.0', 'free-datsun-280z-0789ab2ece9442de94b3c41595e0ecbd'), src: 'free_datsun_280z', length: 4.4, paint: ['280z_CarPaint'], tail: ['280z_Brake_lamp'], head: ['280z_Headlight_lamp'], glass: ['280z_Windows'] },
  'integra-dc2': { credit: sk('Honda Integra (DC2) Type-R 1995', 'Lexyc16', 'CC-BY-NC-4.0', 'honda-integra-dc2-type-r-1995-554e0b342697492391c71d4b882b61fc'), src: 'honda_integra_dc2_type_r_1995', length: 4.38, paint: ['Material'] },
  'caspita': { credit: sk('Jiotto Caspita F1 Road Car 1989 By Alex.Ka.', 'Alex.Ka.', 'CC-BY-NC-4.0', 'jiotto-caspita-f1-road-car-1989-by-alexka-828c84b390624f0389287bd036d7dbf5'), src: 'jiotto_caspita_f1_road_car_1989_by_alex_ka_', length: 4.534, paint: ['Jiotto_Caspita_1989_by_Alex_Ka'], tail: ['tex1_brakelights'] },
  'kansai-spirit': { credit: sk('Kansai Spirit 3.0 TDI', 'dark_igorek', 'CC-BY-4.0', 'kansai-spirit-30-tdi-4d56a0852c774b8881524906422237d1'), src: 'kansai_spirit_3_0_tdi', length: 4.3 },
  'rx7': { credit: sk('Mazda RX-7', 'wallon', 'CC-BY-4.0', 'mazda-rx-7-45cb02e634ed477a9a04bb19813443f2'), src: 'mazda_rx_7', length: 4.285, paint: ['Car_body'] },
  'fairlady-z': { credit: sk('Nissan Fairlady Z S30(240Z) 1978', 'Lexyc16', 'CC-BY-NC-4.0', 'nissan-fairlady-z-s30240z-1978-0d9286ebb8cc426e993e1d398b874a34'), src: 'nissan_fairlady_z_s30240z_1978', length: 4.2, paint: ['Material.001'] },
  'skyline-r32': { credit: sk('Nissan Skyline (R32) GT-R', 'Lexyc16', 'CC-BY-NC-4.0', 'nissan-skyline-r32-gt-r-8810e677eca543a6b840cf67dd064aa4'), src: 'nissan_skyline_r32_gt_r', length: 4.545, paint: ['car_paint'] },
  'skyline-r34': { credit: sk('Nissan Skyline R34 GT-R', 'Lexyc16', 'CC-BY-4.0', 'nissan-skyline-r34-gt-r-ff8fb2251dfa4bb9979e7022c5a6666c'), src: 'nissan_skyline_r34_gt_r', length: 4.6, paint: ['Material.001'] },
  'ae86': { credit: sk('Toyota AE86 Sprinter Trueno Zenki', 'Martin Trafas', 'CC-BY-4.0', 'toyota-ae86-sprinter-trueno-zenki-a5737bf3cc9b4179a6e5ebe173ff70d9'), src: 'toyota_ae86_sprinter_trueno_zenki', length: 4.205, paint: ['Primary'], keepTex: ['LampCovers'] },
  'gr-supra': { credit: sk('Toyota GR Supra', 'thelightning', 'CC-BY-4.0', 'toyota-gr-supra-9231f2d5e71a43dd87603dc0b339d99d'), src: 'toyota_gr_supra', length: 4.38, paint: ['Toyota_Supra_2020_with_Interior_noTTo3Ds_carpaint.001'], chrome: ['Toyota_Supra_2020_with_Interior_noTTo3Ds_chrome.001'], solid: ['Toyota_Supra_2020_with_Interior_noTTo3Ds_chrome.001'], tail: ['Toyota_Supra_2020_with_Interior_noTTo3Ds_lightingRed.001'], bake: ['Color_002.001'] },
  'carry': { credit: sk('Carry Pickup | Suzuki | Game ready', 'by__Rx', 'CC-BY-4.0', 'carry-pickup-suzuki-game-ready-e1654a399b9d448a9a7ce200410ac91d'), src: 'carry_pickup_suzuki_game_ready', length: 3.4, drop: ['lambert2', 'Material'] },
  'supra-gt300': { credit: sk('ToyotaGR Supra GT300 | www.vecarz.com', 'vecarz', 'CC-BY-4.0', 'toyotagr-supra-gt300-wwwvecarzcom-1666c35171b649a8a927da53bdadf228'), src: 'toyotagr_supra_gt300_www_vecarz_com', length: 4.65 },
};
