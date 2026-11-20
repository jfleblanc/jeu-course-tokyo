/**
 * Test de fumée : sert le build (dist/) et ouvre le jeu dans un Chromium sans tête
 * (rendu logiciel, donc repli WebGL2). Échoue si le jeu ne démarre pas ou si la console
 * contient une erreur. Lancé par GitHub Actions avant chaque déploiement :
 * c'est ce qui garantit que `main` reste jouable.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve(process.env.DIST ?? 'dist');
const base = process.env.BASE ?? '/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

const server = http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    const rel = url.pathname.slice(base.length) || 'index.html';
    const file = path.join(dist, rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const problems = [];
page.on('console', (m) => {
  // Le pilote graphique logiciel commente sa propre lenteur (« GL Driver Message … Performance ») :
  // ce ne sont pas des erreurs du jeu, on les ignore.
  if (m.text().includes('GL Driver Message') && m.text().includes('Performance')) return;
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[exception] ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`);
});

let ok = true;
const fail = (msg) => {
  ok = false;
  console.error(`ÉCHEC : ${msg}`);
};

await page.goto(`http://localhost:${port}${base}?webgl&q=bas`);
try {
  await page.waitForFunction(() => Boolean(window.__jeu), null, { timeout: 240_000 });
} catch {
  fail(`le jeu n'a pas démarré : ${await page.locator('#boot-msg').textContent().catch(() => '?')}`);
}

if (ok) {
  await page.waitForTimeout(3000);
  // Écran titre → choix du joueur → nouveau joueur → en jeu.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  if (!(await page.locator('#profils').count())) fail('le choix du joueur ne s’affiche pas après le titre');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.keyboard.type('Essai');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  if (await page.locator('#profils').count()) fail('le choix du joueur ne se ferme pas après la création');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(8000);
  await page.keyboard.up('KeyW');
  const state = await page.evaluate(() => {
    const j = window.__jeu;
    return {
      y: j.car.pos.y,
      vitesse: j.car.forwardSpeed * 3.6,
      rapport: j.car.drivetrain.gearLabel,
      immeubles: j.city.buildings.length,
      rues: j.city.graph.edges.length,
      version: document.getElementById('hud-version')?.textContent ?? '',
    };
  });
  console.log('État :', JSON.stringify(state));
  // (la partie commence dans le garage, au sous-sol : la voiture est soit là, soit déjà dans la rue)
  if (!((state.y > 0.3 && state.y < 1.2) || (state.y > -4.5 && state.y < 0.3))) fail(`hauteur de la voiture anormale (${state.y})`);
  if (!(state.vitesse > 0.5)) fail(`la voiture n'avance pas avec W (${state.vitesse} km/h)`);
  if (!state.version.includes('version')) fail('numéro de version absent du HUD');
  // La capture est un bonus : sur une machine sans carte graphique elle peut être trop lente.
  await page.screenshot({ path: process.env.SHOT ?? 'smoke-test.png', timeout: 90_000 }).catch(() => console.log('Capture d’écran ignorée (trop lente).'));
}
if (problems.length) fail(`console :\n${problems.join('\n')}`);

await browser.close();
server.close();
if (!ok) process.exit(1);
console.log('Test de fumée réussi : le jeu démarre, la voiture roule, aucune erreur console.');
