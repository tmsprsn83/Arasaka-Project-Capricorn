# CAPRICORN — notes techniques

CAPRI : une IA avec qui parler, joyeuse et joueuse, inspirée de Capri (*Cyberpunk: Edgerunners 2*). Projet privé.

- **Cerveau** : Claude Code en mode programme (`claude -p`), avec la connexion déjà faite dans VS Code.
  Personnalité : `capri/personnalite.md`. Pas de commandes système : lecture et écriture de notes, recherche web.
- **Mémoire** : coffre Obsidian `C:\Users\piers.TOMMY\OneDrive\Documents\OBSIDIAN\CAPRICORN\CAPRICORN`,
  dossier `Mémoire de CAPRI/Souvenirs.md`.
- **Réveils** : `Mémoire de CAPRI/Réveils.md`, une ligne `- AAAA-MM-JJ HH:MM | une fois|chaque jour | consigne`
  que CAPRI écrit elle-même. La fenêtre la relit chaque minute (`src/reveils.js`) et donne la consigne à CAPRI,
  qui parle la première, ou se tait si elle répond « RIEN ». Seulement quand la fenêtre est ouverte.
- **Entrée vocale** : [VoiceInput](https://www.voiceinput.ai) colle la dictée dans le champ de la fenêtre, Entrée envoie.
- **Visage « écran » en images** (par défaut) : les images de Tommy (`src/renderer/visage/`, copiées de
  `Nouveau dossier`), découpées au chargement par `src/renderer/visage-sprites.js` : iris mobile dans son anneau,
  paupières de visière posées par-dessus le bord de l’orbite (œil fermé sans démarcation, pointes gardées), bouches
  en image (zigzag, vague, ouverte, cri), couleurs exactes (#00FF66, #8000FF, #0055FF, #FFFFFF) et halo néon
  (vers l'extérieur seulement : orbites nettes). Yeux animés par [Motion](https://motion.dev) (`src/renderer/motion.js`,
  copie de `node_modules/motion/dist/motion.js`) : ressorts pour paupières, sourcil, regard et iris ; clignement en
  images clés. Par moments (toutes les 5 à 18 s, toutes les 1 à 3 s quand elle parle), l'écran glitche façon Blackwall
  (Cyberpunk 2077) : image séparée en couches rouge et verte, bandes déchirées, blocs corrompus, traits, fragments de
  texte système ; uniquement le rouge des cheveux (#F80030) et le vert de la visière (#00FF66).
  Le visage vectoriel ci-dessous sert pendant le chargement.
- **Visage « écran » vectoriel** (repli pendant le chargement) : la visière découpée à liseré violet de
  `HVFvnXxXcAE2SVD.webp`, sur fond bleu-gris, relevée au pixel par `npx electron tools/mesure-visiere.cjs` (→
  `src/renderer/visage-visiere.js` : visière, orbites à pointes, anneaux, iris, pupilles, et décalage de la copie
  violette de chaque pièce). Paupières en pièces de visière qui descendent sur l'orbite (fermée en « U », penchée,
  plissée), pointes gardées. Bouches de `src/renderer/visage-plat.js` (zigzag au repos, ouverte, cri) ; sans
  `visage-visiere.js`, retour à la bande plate des `noFilter*.webp`. Même moteur d'expressions que le visage HD.
- **Visage HD** (plus proposé : Tommy reste sur le visage « écran » ; le code reste dans `capri.js`) : l'image HD `IMAGE_DE_REFERENCE/53a2ce8f-….png` (copiée en `src/renderer/capri.png`), animée par un
  rig façon Live2D en WebGL (`src/renderer/capri.js`) : l'image et les pièces découpées dedans (plaque du visage,
  orbites, disque du regard, mèches de devant, bouche) sont des maillages déformés par des paramètres à ressorts
  (tête tournée / penchée, paupières, regard, bouche, respiration), avec une physique des cheveux.
  Yeux d'après la vidéo de la série (paupière du haut en courbe, œil fermé en « U », regard qui va jusqu'au bord) ;
  bouches d'après la planche d'expressions (sourire, ouverte à la dent, triangle, vague, trait, moue, « o », pixel).
  `tools/build-rig.cjs` reste disponible pour découper les planches de pièces en calques, s'il le faut un jour.
  États : repos, écoute, réflexion, parole ;
  humeurs : rire, coeur, clin, surprise, glitch, boude, triste, fache, joie, colere, excitee, malice, fierte, peur,
  gene, ennui (balises dans ses réponses, accents acceptés). Certaines bougent tout le visage (joie qui sautille,
  colère qui tremble et fait buguer l'écran, peur qui frissonne) et font sortir des signes (cœurs, notes, « z », « ! »,
  veine de colère, goutte).
- **Vivante au repos** (`ACTIVITIES` dans `src/renderer/capri.js`, programmées par `app.js`) : toutes les 7 à 18 s,
  une expression ou une occupation : elle lit (yeux qui balayent des lignes), regarde autour, fredonne, danse, calcule,
  joue avec ses glitchs, s'énerve contre un bug, s'étire. Plus Tommy se tait, plus elle s'ennuie : bâille, soupire,
  somnole puis se réveille en sursaut. Bouches descendues sous la visière (`MOUTH_DROP`), une seule à la fois.
- **Débordante d'énergie, animée par Motion** (`animateBody` dans `visage-sprites.js`) : rebond continu dont le tempo
  suit l'humeur (surexcitée très vive, endormie très lente), écrasement / étirement à ressort à chaque changement
  d'humeur, petit bond à chaque syllabe ; étincelles quand elle est joyeuse (plus de cœurs : retirés par Tommy). Une humeur ou une occupation toutes les
  3 à 7 s. Paupière du bas (œil rieur) en arc, découpée dans le creux de l'œil (orbite, pointes, aile) sans jamais
  recouvrir la visière ni ses traits violets. Garde-fous vérifiés image par image : pop à ±5 % au début d'une humeur
  ou d'une activité seulement, inclinaison bornée à ±4°, marge de 12 % pour que la visière ne sorte jamais de
  l'écran, tremblements réguliers ajoutés au mouvement lissé, glitch Blackwall court et rare (20 à 45 s au repos).
- **Voix** : à venir (voix française de synthèse originale + effets numériques).

## Lancer
```
npm install
npm start
```
Variables facultatives : `CAPRI_CLAUDE` (chemin de claude.exe), `CAPRI_VAULT` (coffre Obsidian).

À chaque ouverture : démarrage Arasaka façon interface de Cyberpunk 2077 (`src/renderer/boot.js`, animé par
Motion, un clic ou une touche l'abrège) : l'emblème Arasaka se trace (SVG d'après « Arasaka logo lite », Wikimedia
Commons, CC0), « ARASAKA », puis « PROJET CAPRICORN » en glitch, chargement, déchirure, et CAPRI apparaît.

### Petit écran et démarrage de Windows
- CAPRI s'ouvre en plein écran sur l'écran USB de 7 pouces (`SD700F_0716`, 1024 × 600), reconnu par son nom ; à
  défaut, sur le plus petit écran secondaire. Branché après coup, elle y part ; débranché, elle revient en fenêtre
  sur l'écran principal. Échap sort du plein écran, F11 y revient.
- `npm run demarrage` : lancement à l'ouverture de session Windows (clé « Exécuter » de l'utilisateur) ;
  `npm run demarrage:retirer` pour l'enlever.

### Zone de notification
CAPRI a son icône dans la zone de notification (`src/renderer/visage/icone.png`, faite par `npx electron tools/icone.cjs`).
Fermer sa fenêtre la range là ; clic : la montrer ; clic droit : plein écran, premier plan, messages sur l'écran
principal, Notifications (son et Windows), Quitter CAPRI. Les deux réglages sont aussi dans la barre de CAPRI
(boutons ♪ et ⧉, verts quand ils sont actifs), synchronisés avec le menu et retenus (`reglages.json`). Relancée alors qu'elle tourne déjà, elle se montre (une seule instance).

### Sons
Le son de notification de Tommy (`audio/audio_notification.mp4`, extrait en `src/renderer/sons/notification.ogg`) : à
chaque nouveau message sur l'écran principal, et quand elle parle la première (réveil, bouderie) sans calque. La
sonnerie d'appel (`audio/audio_appel.mp4`) n'est pas utilisée : les messages ne sont pas des appels.

### Calque sur l'écran principal
Quand CAPRI a son écran dédié, une page transparente couvre l'écran principal (`src/renderer/overlay.html`,
toujours au premier plan, les clics la traversent, absente de la barre des tâches). Ce qu'elle dit s'y écrit en haut de
l'écran, en même temps que dans sa fenêtre : un nouveau message, dans le style de l'appel entrant de Cyberpunk 2077
(photo « DELAMAIN INCOMING CALL ») : micro-lignes rouges, icône de message cyan, portrait rouge avec sa languette et sa pile de cadres,
portrait de CAPRI en hologramme rouge (`visage/portrait.png`, tiré de l'image HD), identifiant, « CAPRI » en cyan, « NOUVEAU MESSAGE » en rouge, le texte, touches [T]. Animé par Motion ; il s'en va
quelques secondes après qu'elle s'est tue.

### Éclairage du PC (ventilateurs MSI)
Quand CAPRI parle, l'éclairage de la carte mère (MSI PRO Z890-S, Mystic Light, ventilateurs ARGB) bugge en rouge
(#F80030) et vert (#00FF66) seulement, par rafales irrégulières ; quand elle se tait, il revient au violet (`REPOS`
dans `tools/lumiere.cjs`). Le SDK ne voit qu'une zone « SELECT ALL » (aucune LED nommée) : pas de pilotage LED par
LED par MSI Center.
- Passe par MSI Center avec le Mystic Light SDK officiel (`tools/msi/MysticLight_SDK.dll`, version x64 1.0.0.8,
  signée MSI, de `download.msi.com/uti_exe/Mystic_light_SDK.zip`). Le SDK exige les droits administrateur : un petit
  service à part (`tools/msi/CapriLumiere.cs`) les a, CAPRI (`src/lumiere.js`) lui dit seulement « parle 1 / 0 » par
  le canal `\\.\pipe\capri-lumiere`, ouvert au seul compte de Tommy.
- `npm run lumiere -- --sonde` : relève l'éclairage (zones, styles, couleurs) sans rien changer.
- `npm run lumiere` : copie le service dans `C:\Program Files\CAPRICORN\lumiere` (modifiable seulement en
  administrateur) et crée la tâche planifiée « CAPRICORN Lumiere » (ouverture de session, droits élevés, sans invite).
  Une autorisation administrateur est demandée à l'installation seulement. `npm run lumiere -- --retirer` l'enlève.
- Résultat de chaque commande : `tools/lumiere-resultat.txt`.

## Tests
```
npm test
```

Images de référence : `IMAGE_DE_REFERENCE/`.
