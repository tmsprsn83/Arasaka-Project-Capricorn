# CAPRI pour Live2D Cubism

`capri-depart.psd` : PSD de départ tiré de l'image HD (`src/renderer/capri.png`), 1725 × 912, 19 calques.
Régénérer : `npx electron tools/build-psd.cjs` (écrase le PSD : retoucher une copie).

## Calques (de bas en haut)
| Calque | Contenu | À retoucher |
|---|---|---|
| Fond | couleur du fond, ligne par ligne | rien |
| Cheveux arrière | toute la chevelure hors visage | découper en mèches (une par calque) pour la physique |
| Corps | cou et buste | rien |
| Tête | visage sans yeux ni bouche ; crâne (ellipse noire) et visière bouchés sous les mèches | bord de l'ellipse, quelques pixels rouges en haut de la visière |
| Œil D / Œil G : Orbite, Iris, Paupière | orbite noire à pointes ; disque du regard (anneau, iris, pupille) ; paupière = disque de visière, **masquée** | paupière à déformer en « U » pour fermer l'œil |
| Bouche : sourire, ouverte, rire, o, triangle, zigzag, moue, plate | formes de la planche d'expressions ; seul « sourire » est visible | rien |
| Mèches devant | mèches au-dessus du visage | séparer en 3 à 5 mèches |

G et D suivent la convention Live2D : **G = œil gauche de CAPRI**, à droite de l'écran.
Cubism importe aussi les calques masqués : régler leur opacité par les paramètres.

## Paramètres à créer (noms standard, branchés ensuite dans l'application)
- Tête et corps : `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamBodyAngleX`, `ParamBreath`.
- Yeux : `ParamEyeLOpen`, `ParamEyeROpen` (paupière qui descend en « U » sur l'œil, qui ne s'écrase pas),
  `ParamEyeBallX`, `ParamEyeBallY` (iris dans l'orbite).
- Sourcils (fâchée, triste) : `ParamBrowLAngle`, `ParamBrowRAngle` (inclinaison des paupières).
- Bouche : `ParamMouthOpenY` (sourire → ouverte), `ParamMouthForm` (moue → rire) ; formes à part (o, triangle,
  zigzag, plate) par opacité.
- Cheveux : physique (`physics3.json`) sur les mèches de devant et de derrière.

## Export attendu
Dossier de Cubism (`.moc3`, `.model3.json`, `.physics3.json`, textures) à déposer dans `IMAGE_DE_REFERENCE`.
