# Lancer l'Arène en live sur TikTok (pas à pas)

## 0. Une fois pour toutes : ton compte TikTok

Conditions officielles TikTok (centre d'aide, novembre 2026) :

| Pour… | Il faut |
|---|---|
| Passer en LIVE | **18 ans ou plus** et **1 000 followers** (peut varier selon le pays) |
| Recevoir des cadeaux (Roses, Galaxy…) | 18 ans ou plus, vivre dans un pays où les cadeaux existent (la France oui), compte en règle |

**Prouver que tu es majeur** : au moment de passer en LIVE, TikTok peut te demander de confirmer ton âge.
Selon le pays : photo de ta pièce d'identité + selfies, selfie + pièce d'identité via Incode (tu as 15 min),
carte bancaire (petit débit temporaire, remboursé) ou estimation de l'âge par selfie. Suis les écrans de l'appli.

**Activer les cadeaux** : écran LIVE → **Paramètres** → active **Cadeaux LIVE** → Passer en LIVE.

**Toucher l'argent (le « porte-monnaie »)** :
1. Les cadeaux deviennent des **Diamants** (visibles dans le résumé de fin de live).
2. Profil → menu ☰ → **Solde** (ou Outils de créateur → Récompenses LIVE) → **Retirer**.
3. Ajoute un moyen de paiement : **PayPal vérifié** ou virement bancaire.
   Le nom doit être **exactement** le même que celui de ton compte TikTok, sinon le retrait échoue.
4. TikTok peut demander une pièce d'identité avant de payer.

Les noms des menus changent parfois d'une version de l'appli à l'autre. Ces étapes, tu les fais toi-même dans l'appli
(pièce d'identité, compte bancaire) : personne d'autre ne doit les faire à ta place.

**TikTok LIVE Studio** (logiciel PC pour streamer) : à télécharger sur tiktok.com/studio, puis connexion avec ton compte.
Il n'est pas encore installé sur ce PC. L'accès dépend de ton compte (followers, ancienneté, historique de lives).

## 1. Une fois pour toutes : le cerveau de Maxima

Maxima essaie dans cet ordre : **Gemma 4 sur ton PC** → **Groq (en ligne)** → **phrases pré-écrites**.
Si Gemma n'a pas répondu au bout de 8 s, Groq est lancé en renfort et la première réponse gagne. Si rien n'est arrivé
après 10 s (14 s pour une réponse au chat), Maxima dit une phrase pré-écrite pour ne jamais laisser de blanc.

**Gemma 4 (local, gratuit, sans limite)** : déjà installé sur ce PC (Ollama + modèle `gemma4:e2b`).
- Ton PC n'a pas de carte graphique dédiée : Gemma tourne sur le processeur et met **5 à 7 s par réplique**.
  Maxima commente donc l'action avec quelques secondes de décalage. C'est normal.
- Le modèle plus fin `gemma4:e4b` est aussi installé, mais il met 9 à 13 s. Pour l'essayer : `OLLAMA_MODEL=gemma4:e4b`
  dans `.env`. Pour libérer 6,6 Go : `ollama rm gemma4:e4b`.
- Ollama démarre tout seul avec Windows (icône de lama près de l'horloge). Gemma reste en mémoire pendant le live
  (quelques Go de RAM). Ferme les gros programmes inutiles.
- Si le live saccade pendant que Maxima réfléchit, mets `OLLAMA_THREADS=6` dans `.env` : Gemma laissera du processeur au stream.
- Pour vérifier : onglet 🧠 IA & modération du backstage (« ollama » doit être vert).

**Groq (en ligne, secours rapide)** : sans clé, il n'y a pas de secours quand Gemma est lente.

1. Va sur https://console.groq.com, crée un compte, puis **API Keys → Create API Key**.
2. Ouvre le fichier `.env` (dans ce dossier) et colle la clé après `GROQ_API_KEY=`.
3. Mets aussi ton pseudo TikTok après `TIKTOK_USERNAME=` (sans @).

Le **forfait gratuit** de Groq suffit pour tester : environ 25 à 30 minutes de commentaires par jour (limite de 200 000
tokens par jour). Dans ce cas, mets le « délai entre deux répliques » à 7 s dans le backstage (onglet ⚙️ Réglages).
Pour de vrais lives de plusieurs heures, passe au forfait **Developer** de Groq (paiement à l'usage, avec carte bancaire).
Avec le modèle `openai/gpt-oss-120b` (0,15 $ par million de tokens en entrée, 0,60 $ en sortie), ça coûte environ
**0,10 à 0,20 $ de l'heure** (estimation).

## 2. À chaque live

1. **Lance le programme** : ouvre PowerShell dans le dossier `LiveInteractif` et tape `npm start`.
2. **Ouvre le backstage** : http://localhost:3030 (tes stats, le chat, ce que dit Maxima, les réglages).
3. **Ouvre l'overlay dans Microsoft Edge** : http://localhost:3030/overlay.html.
   Edge a les meilleures voix (Denise, Eloise). **Clique une fois dans la fenêtre** pour autoriser le son.
4. **Dans TikTok LIVE Studio** (format vertical) :
   - ajoute ta **caméra et ton micro** (voir l'encadré plus bas : ta présence compte) ;
   - ajoute l'arène : **Capture de fenêtre** sur la fenêtre Edge de l'overlay.
     Tu peux aussi essayer une source **Lien** avec l'URL de l'overlay, mais la voix risque de ne pas passer ;
   - vérifie que LIVE Studio capte bien **le son du PC**, sinon on n'entendra pas Maxima.
5. **Passe en LIVE.** En 30 s maximum, le backstage affiche « live » : les commentaires, likes et cadeaux arrivent dans l'arène.
6. Fais d'abord un **live test de 5 minutes** : écris un commentaire avec ton 2e téléphone, envoie une Rose et vérifie
   que tout réagit (inscription, épée, voix de Maxima).

## 3. Ce que fait Maxima (et ce qu'elle ne fait pas)

- Elle **lit** tout : commentaires, likes (cœurs), cadeaux, partages, abonnements, nombre de viewers.
- Elle **répond à voix haute** (et dans une bulle à l'écran) :
  - aux questions (message avec « ? » ou « Maxima »), au plus une fois toutes les 20 s par viewer ;
  - aux **3 plus gros donateurs** ;
  - aux **3 viewers qui commentent le plus** et aux **3 qui envoient le plus de cœurs** (au plus une fois par minute chacun).
- Elle **commente** les combats, remercie pour les cadeaux et relance l'ambiance quand c'est calme.
- Toutes les 3 min, elle fait une **mention spéciale** au viewer le plus bavard et à celui qui envoie le plus de cœurs.
- Elle **remercie ceux qui partagent le live ou s'abonnent** (regroupés : « Merci Alice, Bob pour le partage ! »).
- Toutes les 5 min, elle **invite gentiment à partager le live ou à s'abonner**, sans rien promettre en échange
  (les règles TikTok interdisent de promettre un avantage contre un partage ou un abonnement).
- Ces deux rythmes se règlent dans le backstage (⚙️ Réglages : de 0 = jamais à 30 ou 60 min). Ne descends pas trop bas :
  une invitation répétée en boucle est vue par TikTok comme de la sollicitation mécanique.
- Elle se souvient des viewers d'un live à l'autre.
- Elle **n'écrit pas dans le chat TikTok** : la connexion est en lecture seule. Elle parle dans le live.
- Un filtre bloque les insultes et les contenus douteux, à l'entrée comme à la sortie. Elle ne réclame jamais de cadeaux.

## ⚠️ Important : un live 100 % automatique peut perdre les cadeaux

Les règles de monétisation LIVE de TikTok disent qu'un live peut être **démonétisé** (plus de cadeaux) s'il est :
- « généré ou piloté principalement par des systèmes automatisés, comme l'IA… sans présence significative du créateur » ;
- « largement passif ou sans surveillance ».

Le jeu est interactif, c'est un bon point. Mais pour garder les cadeaux, **sois présent** : caméra ou micro, réponds au
chat de temps en temps et anime avec Maxima. Ne laisse pas le live tourner seul la nuit. Si tu dois t'absenter, mets le
live en pause dans LIVE Studio. Évite aussi de **réclamer des cadeaux en boucle** : c'est du « gift baiting », sanctionné.
En cas de sanction : Outils de créateur → LIVE Center → Règles et conseils → Restrictions (tu peux faire appel).

## 4. Limites connues

- Le **catalogue officiel des cadeaux** (prix et images exacts) demande un forfait payant chez Euler Stream : le barème
  affiche donc des prix indicatifs. Les pouvoirs, eux, se basent bien sur le **vrai prix** de chaque cadeau reçu.
  Le message « catalogue des cadeaux indisponible » dans la console est normal.
- Si la connexion TikTok échoue à cause des limites gratuites, crée une clé sur eulerstream.com et mets-la dans
  `TIKTOK_SIGN_API_KEY`.
- Planning automatique : `SCHEDULE=18:00-23:30` dans `.env`. Le programme se branche tout seul sur ton live dans ces
  plages, mais **c'est toi qui démarres le live** dans LIVE Studio.
