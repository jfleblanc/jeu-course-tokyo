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
import { Race } from '../src/race/race';
import { buildTrackBank } from '../src/race/trackBank';
import { driveAlongRoute } from '../src/ai/driver';

const phys = await createPhysicsWorld();
const city = generateCity(WORLD.seed);
buildCityColliders(city, phys);
const car = new Vehicle(phys, CAR_SPEC, { x: city.spawn.x, y: 0.8, z: city.spawn.z, yaw: city.spawn.yaw });
const input = emptyDriveInput();
const bank = buildTrackBank(city.graph, city.mountain?.road);
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
  race.start(track.route, { difficulty: aiDifficulty(lvl) * (1 + (gr - 1) * CAR_MATCH.grip + (pr - 1) * CAR_MATCH.topSpeed), power: 1 + (pr - 1) * CAR_MATCH.power, grip: 1 + (gr - 1) * CAR_MATCH.grip });
  const me = AI_DRIVERS[1]!; let n = 0; let maxY = 0;
  while (n < 60 * 260 && !race.racers.every((r) => r.finished)) {
    if (race.phase === 'running' && !race.player!.finished) driveAlongRoute(car, race.route!, race.player!.index, me, 1, 0, input); else { input.throttle = 0; input.brake = 1; input.steer = 0; }
    car.update(FIXED_DT, race.playerInput(input), PRESET_A);
    race.beforeStep(FIXED_DT, PRESET_A);
    phys.world.step(); car.afterStep(); race.afterStep(FIXED_DT);
    maxY = Math.max(maxY, car.pos.y); n++;
  }
  console.log(`« ${track.name} » (${d.name}${stray ? ', ' + stray + ' RUES HORS QUARTIER' : ''}): ` + race.racers.map((r) => `${r.name.split(' ')[0]} ${r.finished ? r.finishTime.toFixed(0) + ' s' : 'PAS ARRIVÉ'} (${r.resets} repl.)`).join(' ; ') + ` ; altitude max ${maxY.toFixed(0)} m ; mallettes ${race.pickups.length}`);
  race.stop();
}
