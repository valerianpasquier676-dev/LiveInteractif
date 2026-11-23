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
| 100+ | 🧛 Vampire | Dégâts x2, vole 50 % des dégâts en vie |
| 200+ | ⚡ Foudre | Frappe toute l'arène |
| 1000+ | ☄️ Légende | Météores + dégâts x3 |

- **Événements d'arène** : tremblement de terre / pluie de feu toutes les ~25 s, séries d'éliminations (🔥 en feu), 🩸 carnage.
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
- **PC allumé en permanence** : `SCHEDULE=12:00-14:00,18:00-23:30` dans `.env`. Dans ces plages le programme se connecte tout seul à ton live et réessaie toutes les 30 s tant que tu n'es pas en live ; hors plage il se déconnecte. Il suffit de lancer le live TikTok à ces moments-là. Le backstage permet de forcer ON/OFF.
- **IA en cascade** : Gemma via [Ollama](https://ollama.com) (`ollama pull <tag gemma>`, tag dans `OLLAMA_MODEL`) → **Groq** (`GROQ_API_KEY`) → phrases pré-écrites. Un fournisseur en panne est mis de côté 30 s. Le backstage montre l'état de chacun (serveur joignable, modèle téléchargé ?).
- **Overlay** `http://localhost:3000/overlay.html` : arène animée plein écran (format vertical) avec la **voix de Maximus** (clique sur « Activer la voix » une fois : le navigateur l'exige). Pas besoin d'OBS : ouvre simplement la page.
- Tests : `npm test`.

## Structure

```
src/config.js   config + paliers de pouvoirs
src/db.js       SQLite : joueurs, stats, historique des messages
src/game.js     moteur (lobby -> combat -> fin), événements
src/ai.js       Maximus : file de priorité, mémoire, phrases pré-écrites
src/llm.js      cascade Ollama/Gemma -> Groq, état et santé
src/tiktok.js   connexion live + planning horaire
src/sim.js      faux viewers
src/server.js   HTTP + SSE + API
public/         backstage (index.html) + overlay animé avec voix (overlay.html)
```

## Prochaines étapes

- Avatars TikTok des viewers dans l'arène
- Voix plus naturelle (TTS neuronal) à la place de la voix du navigateur
- Saisons et classement all-time
- Modération du chat avant envoi à l'IA
