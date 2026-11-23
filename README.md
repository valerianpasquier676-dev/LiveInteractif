# ⚔️ Arène des viewers

Jeu live TikTok piloté par le chat, avec **Maximus**, un commentateur IA (Gemma via Ollama) qui se souvient des viewers.

## Fonctionnement

- **Inscription** : un commentaire, un like ou un cadeau pendant la phase d'inscriptions = tu entres dans l'arène.
- **Combat** automatique entre tous les inscrits, jusqu'au dernier debout (duel final, mort subite après 90 s).
- **Cadeau = pouvoir** (cumulé sur le round) :

| Pièces | Pouvoir | Effet |
|---|---|---|
| 1+ | 🗡️ Épée | Dégâts x2 |
| 10+ | 🛡️ Bouclier | Retour en vie (1 fois) |
| 50+ | 🔥 Berserk | Géant, +50 % PV, dégâts x3 |
| 200+ | ⚡ Foudre | Frappe toute l'arène |
| 1000+ | ☄️ Légende | Météores + dégâts x3 |

- **Like = soin** ; 300 likes = ❤️ **Pluie de cœurs** (soigne tout le monde).
- **Maximus (IA)** : commente l'action, remercie les gros donateurs, répond aux questions et aux top donateurs. L'historique de chaque viewer est stocké en SQLite et réinjecté dans le prompt.
- **Backstage** (`http://localhost:3000`) : gladiateurs en direct, classement, top donateurs, flux d'événements, paroles de l'IA, simulateur.

## Lancer

Node 22.5+ requis (SQLite intégré).

```powershell
npm install
copy .env.example .env     # puis édite TIKTOK_USERNAME
npm start
```

- Sans `TIKTOK_USERNAME` : **mode simulation** (faux viewers + boutons de test).
- IA : installe [Ollama](https://ollama.com), `ollama pull <modèle gemma>`, mets le tag dans `OLLAMA_MODEL`. Sans Ollama, Maximus utilise des phrases de secours.
- Tests : `npm test`.

## Structure

```
src/config.js   config + paliers de pouvoirs
src/db.js       SQLite : joueurs, stats, historique des messages
src/game.js     moteur (lobby -> combat -> fin), événements
src/ai.js       Maximus : file de priorité, mémoire, appel Ollama
src/tiktok.js   connexion live (tiktok-live-connector)
src/sim.js      faux viewers
src/server.js   HTTP + SSE + API
public/         dashboard backstage
```

## Prochaines étapes

- Overlay visuel (arène animée) pour OBS / TikTok Live Studio
- Voix de Maximus (TTS) et sous-titres
- Pouvoirs/événements supplémentaires, saisons et classement all-time
- Modération du chat avant envoi à l'IA
