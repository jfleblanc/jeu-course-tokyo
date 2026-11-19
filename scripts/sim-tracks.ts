/** Courses dans les quartiers et sur le col : sh scripts/run-sim.sh tracks */
import { createPhysicsWorld } from '../src/physics/physicsWorld';
import { Vehicle } from '../src/vehicle/vehicle';
import { CAR_SPEC, PRESET_A } from '../src/config/handling';
import { WORLD } from '../src/config/world';
import { AI_DRIVERS, CAR_MATCH } from '../src/config/race';
import { CAR_MODELS } from '../src/config/cars';
import { aiDifficulty } from '../src/config/progression';
import { generateCity } from '../src/world/cityGen';
import { buildCityColliders } from '../src/world/cityColliders';
import { emptyDriveInput } from '../src/input/actions';
import { FIXED_DT } from '../src/core/loop';
import { medalsFor, Race } from '../src/race/race';
import { buildTrackBank } from '../src/race/trackBank';
import { driveAlongRoute } from '../src/ai/driver';

const phys = await createPhysicsWorld();
const city = generateCity(WORLD.seed);
buildCityColliders(city, phys);
const car = new Vehicle(phys, CAR_SPEC, { x: city.spawn.x, y: 0.8, z: city.spawn.z, yaw: city.spawn.yaw });
const input = emptyDriveInput();
const bank = buildTrackBank(city.graph, city.mountain?.road, city.mountain ? [...city.links, { name: 'Col de Hakone', nodeA: city.mountain.nodeA, nodeB: city.mountain.nodeB, road: city.mountain.road }] : city.links);
const names = ['ville', ...city.graph.districts.map((d) => d.name)];
for (let s = -1; s < city.graph.districts.length; s++) console.log(`${names[s + 1]}: ` + bank.filter((t) => t.district === s).map((t) => `${t.name} (${t.circuit ? t.route.laps + ' × ' : ''}${Math.round(t.route.lapLength)} m)`).join(' ; '));
const only = process.env.SEUL;
for (const track of bank.filter((t) => t.district >= 0 && (!only || t.name.includes(only)))) {
  // le tracé reste-t-il dans son quartier ?
  const d = city.graph.districts[track.district]!;
  const stray = track.route.edges.filter((id) => city.graph.edges[id]!.district !== track.district).length;
  const race = new Race(phys, CAR_SPEC, car);
  // VOITURE=gt300 : le « joueur » a cette voiture ; les adversaires se mettent à sa hauteur comme en jeu.
  const mdl = CAR_MODELS.find((c) => c.id === process.env.VOITURE);
  const pr = mdl ? mdl.power : 1, gr = mdl ? mdl.grip : 1;
  const lvl = Number(process.env.NIVEAU ?? 5);
  // MODE=poursuite|chrono|drift : une épreuve au lieu d'une course.
  race.start(track.route, { mode: (process.env.MODE as 'course' | undefined) ?? 'course', difficulty: aiDifficulty(lvl) * (1 + (gr - 1) * CAR_MATCH.grip + (pr - 1) * CAR_MATCH.topSpeed), power: 1 + (pr - 1) * CAR_MATCH.power, grip: 1 + (gr - 1) * CAR_MATCH.grip });
  // JOUEUR=1.3 : un « joueur » plus fort que les adversaires (pour voir s'ils reviennent une fois doublés).
  const pf = Number(process.env.JOUEUR ?? 1);
  const me = { ...AI_DRIVERS[1]!, cornerGrip: AI_DRIVERS[1]!.cornerGrip * pf * pf, braking: AI_DRIVERS[1]!.braking * pf }; let n = 0; let maxY = 0;
  const mine = { ...PRESET_A, gripFront: PRESET_A.gripFront * pf * pf, gripRear: PRESET_A.gripRear * pf * pf, gripLong: PRESET_A.gripLong * pf * pf, brakeForce: PRESET_A.brakeForce * pf };
  let trace = '';
  while (n < 60 * 260 && !(race.mode === 'course' ? race.racers.every((r) => r.finished) : race.phase === 'finished')) {
    if (race.phase === 'running' && !race.player!.finished) driveAlongRoute(car, race.route!, race.player!.index, me, pf, 0, input); else { input.throttle = 0; input.brake = 1; input.steer = 0; }
    if (pf !== 1) car.powerBoost = pf * pf;
    car.update(FIXED_DT, race.playerInput(input), mine);
    if (pf !== 1 && race.phase === 'running' && n % 600 === 0) { const best = Math.max(...race.racers.filter((r) => !r.isPlayer).map((r) => r.progress)); trace += ` ${(best - race.player!.progress).toFixed(0)}`; }
    race.beforeStep(FIXED_DT, PRESET_A);
    phys.world.step(); car.afterStep(); race.afterStep(FIXED_DT);
    maxY = Math.max(maxY, car.pos.y); n++;
  }
  console.log(`« ${track.name} » (${d.name}${stray ? ', ' + stray + ' RUES HORS QUARTIER' : ''}): ` + race.racers.map((r) => `${r.name.split(' ')[0]} ${r.finished ? r.finishTime.toFixed(0) + ' s' : 'PAS ARRIVÉ'} (${r.resets} repl.)`).join(' ; ') + ` ; altitude max ${maxY.toFixed(0)} m ; mallettes ${race.pickups.length}`);
  if (race.mode !== 'course') console.log(`   épreuve ${race.mode} : résultat ${['or', 'argent', 'bronze', 'rien'][race.place() - 1]} ; temps ${race.player!.finishTime.toFixed(0)} s ; points ${race.score.toFixed(0)} ; rattrapé ${race.caught} ; écart ${race.escapedBy.toFixed(0)} m`);
  { const m = medalsFor('chrono', track.route, race.difficulty); console.log(`   contre-la-montre : or ${m![0].toFixed(0)} s, argent ${m![1].toFixed(0)} s, bronze ${m![2].toFixed(0)} s`); }
  if (trace) console.log('   écart du meilleur adversaire sur le joueur, toutes les 10 s (m) :' + trace);
  race.stop();
}
