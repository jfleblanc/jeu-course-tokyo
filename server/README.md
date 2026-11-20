# Serveur du jeu (Cloudflare Workers)

Adresse : https://course.jfleblanc.com — compte Cloudflare de la famille, zone `jfleblanc.com`.

- `worker.js` : le Worker. Routes `/salon/CODE` (WebSocket, salon multijoueur), `/api/records` (classement partagé), `/api/sante` ; tout le reste est le jeu, relayé depuis GitHub Pages.
- `protocole.js` : les règles du salon et du classement (sans rien de propre à Cloudflare).
- `dev-server.mjs` : le même serveur en local pour les essais (`node server/dev-server.mjs`, puis le jeu avec `?serveur=http://localhost:8787`).

Deux objets durables (stockage SQLite, offre gratuite) : `Salon` (un par code de salon) et `Classement` (un seul, « monde »).

## Déployer
Avec Wrangler, depuis ce dossier : `npx wrangler deploy` (voir `wrangler.toml`). Le premier déploiement a été fait par l'API Cloudflare.

## Limites connues
- Le serveur relaie sans vérifier : un joueur pourrait tricher sur sa position ou son temps. Acceptable entre amis.
- 4 joueurs par salon (`MAX_JOUEURS` dans `protocole.js`).
- Offre gratuite : 100 000 requêtes par jour ; un message WebSocket compte pour 1/20 de requête. Quatre joueurs en salon consomment environ 7 000 requêtes par heure.
