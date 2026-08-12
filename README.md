# Réception — cartons de livres

Application web de réception de cartons de livres à l'export, conçue pour un
iPhone en entrepôt et déployée sur Vercel.

Un carton arrive, un bon de commande papier est dedans. L'app le photographie,
le lit, fait contrôler ce qui est douteux, puis fait scanner les livres un à un
pour vérifier physiquement ce qui est réellement dans le carton. À la clôture,
elle produit un récapitulatif des écarts et efface tout.

---

## Le déroulé

| Phase | Ce qui se passe |
|---|---|
| 1. Capture | Les pages du bon sont photographiées une à une, ou importées depuis la photothèque. Elles s'accumulent dans une zone de préparation où l'on peut retirer une photo ratée avant de lancer la lecture. |
| 2. Lecture | Chaque page passe dans **deux moteurs Mistral indépendants**, côté serveur, et les résultats sont comparés champ à champ. |
| 3. Contrôle | Seules les lignes dont l'**ISBN ou la quantité** restent douteux remontent, avec la photo de la page en regard pour trancher. |
| 4. Scan | Caméra en continu. Quantité 1 → voile vert plein écran, 1,2 s. Quantité > 1 → feuille de validation. |
| 5. Clôture | Manques, surplus, abîmés, hors commande. Export PDF + CSV, puis **purge totale**. |

## La fiabilité de lecture

C'est le point critique : une erreur d'OCR sur un ISBN ou une quantité passe
directement en litige fournisseur. Trois garde-fous se cumulent.

**Double lecture croisée.** Chaque page est envoyée en parallèle à deux moteurs
Mistral différents — l'endpoint OCR documentaire et un modèle vision — avec le
*même* schéma JSON strict, donc des sorties directement comparables champ à
champ. Deux moteurs qui se trompent au même endroit de la même façon, c'est très
improbable ; deux moteurs qui divergent, c'est un signal.

L'endpoint OCR ne prend pas de consigne libre : il ne reçoit que le schéma. Les
règles de découpage vivent donc **dans le schéma lui-même**, à sa racine, et non
seulement dans l'instruction envoyée au modèle vision — sans quoi la moitié de la
double lecture travaillerait sans elles. Un second moteur qui répond sans avoir
lu la moindre ligne est écarté plutôt que compté comme un avis : c'est une panne
silencieuse, et la page est annoncée dégradée.

**Clé de contrôle ISBN.** Tout ISBN est validé par sa clé (EAN-13 ou ISBN-10,
converti en 13). Un chiffre mal lu casse la clé dans 9 cas sur 10 — détecté même
quand les deux moteurs lisent la même chose.

**Ce que la clé peut trancher, elle le tranche.** Quand les deux moteurs lisent
deux ISBN différents et qu'un seul porte une clé de contrôle valide, il n'y a
rien à arbitrer : l'autre est faux. L'app retient le valide sans rien demander,
et se contente de le mentionner. Faire valider ce cas par un humain reviendrait à
lui demander de recalculer une clé EAN-13 de tête.

**Rien n'est deviné pour autant.** Deux ISBN valides mais différents, ou deux
clés fausses, restent indécidables : l'app affiche les deux lectures côte à côte
avec la photo de la page, et attend l'arbitrage. Le bouton de validation reste
désactivé tant qu'il reste une ligne à trancher.

**Trois familles arrêtent l'opérateur, et trois seulement :**

1. **un ISBN faux ou absent** — clé de contrôle cassée, champ vide ;
2. **deux ISBN valides en concurrence sur un même titre** — les deux moteurs en
   proposent un chacun et la clé ne départage pas, ou le même libellé se
   retrouve sur deux codes ;
3. **une quantité incohérente** — les deux lectures divergent, la case est vide,
   ou une ligne n'a été vue que par un seul moteur alors que les deux ont
   répondu, auquel cas rien ne corrobore sa quantité.

Tout le reste s'affiche sur la ligne, corrigeable, sans entrer dans la file :
titre ou éditeur lus différemment, titre absent, doublon d'ISBN fusionné, ISBN
tranché par sa clé. Une file qui contient tout ne se distingue pas d'une file
vide : on finit par tout valider sans regarder.

**Les colonnes doivent se répondre.** Trois contrôles ne portent pas sur la
lecture d'un champ mais sur le lien entre l'ISBN et le titre — le lien qui décide
quel livre sera décompté sur quelle ligne. Ceux-là bloquent, alors qu'une simple
divergence d'orthographe ne bloque pas :

- **tout ISBN a un titre.** Sans lui, l'écran de scan annonce un livre que
  l'opérateur ne peut pas reconnaître ;
- **un titre ne porte qu'un ISBN.** Le même libellé sur deux codes, c'est un
  bloc recopié pendant qu'un autre perdait le sien ;
- **un ISBN ne porte qu'un sujet.** Deux lignes de même code aux titres sans
  rapport, ce n'est pas un doublon : c'est un rattachement faux d'un côté.

La comparaison des titres se fait à l'identique, jamais par ressemblance :
`DRUUNA T01` et `DRUUNA T02` se ressemblent à 90 % et sont deux livres.

**Un ISBN, une ligne.** Le même ISBN vu deux fois n'est pas une commande de deux
lots : c'est le même bloc du bordereau lu deux fois. Les lignes sont réunies sans
rien demander, et l'app garde **la plus grande** quantité des deux, jamais leur
somme — additionner ferait chercher un exemplaire qui n'existe pas, et le carton
finirait en manque imaginaire.

**Contrôle du total imprimé.** Quand le bordereau porte un total d'exemplaires ou
de références (« QUANTITE: 23 », « ARTICLES: 19 »), l'app le compare à ce qu'elle
a lu, dans les deux sens. En moins, c'est une ligne sautée par les deux moteurs à
la fois — la double lecture, elle, ne voit rien quand ils omettent la même chose.
En trop, c'est un complément de libellé passé pour un titre, ou un ISBN qui
figurait réellement deux fois. L'avertissement est indicatif et non bloquant : sur
un bordereau multi-échéances, le total imprimé couvre souvent plus que les pages
photographiées. Il ne bloque donc pas, mais il ne se franchit pas sans avoir été
lu : la dernière porte avant le scan le rappelle et change de libellé pour
« Scanner malgré l'écart ».

Le prompt prend soin de distinguer ce total de la ligne « TOTAL COMMANDE
REFERENCE ... ARTICLES 77 » imprimée juste à côté sur les bordereaux Hachette :
celle-là couvre la commande entière, toutes livraisons confondues, et ferait
sonner l'alarme à chaque carton.

Le prompt impose par ailleurs aux modèles de renvoyer une valeur vide plutôt que
de compléter de mémoire — un ISBN plausible mais inventé serait le pire des cas,
puisqu'il passerait la clé de contrôle.

### Ce que le schéma tient compte des bordereaux réels

Le schéma d'extraction est calé sur des bordereaux SODIS/Gallimard et CDL
Hachette, dont les mises en page n'ont rien de commun :

- **Pas de colonne « auteur ».** La seconde ligne de la cellule de libellé porte
  l'**éditeur ou la collection** (`FOLIO`, `GALLIMARD JEUNE`, `GLENAT`,
  `HACHETTE HEROES`). Demander un auteur produirait des divergences fantômes
  entre les deux moteurs sur presque chaque ligne.
- **Une seule colonne de quantité** le plus souvent (`Qté`, `QTE`). Le champ
  « commandé » n'est renseigné que si une colonne distincte existe.
- **Un article occupe un bloc de deux lignes imprimées**, parfois trois. La
  première porte la référence interne, la quantité et le titre ; la seconde
  porte l'ISBN, un éventuel complément de titre (`LFF B1`, `NED`, `LE AUDIO`) et
  l'éditeur. Voir plus bas : c'est la principale source d'erreur de ces
  documents.
- **Références internes du distributeur** mêlées aux ISBN dans la même colonne
  (`20 3087 8`, `45 0505 0`). Le prompt les exclut du champ `isbn` et les
  extrait dans un champ `reference` à part, où elles servent de seconde clé
  d'appariement entre les deux lectures.
- **Un intertitre coupe le tableau en deux.** `R E P O N S E S`, `NON-SERVI DE
  VOTRE LIVRAISON`, `MANQUANT`, `Reliquat` : à partir de là et jusqu'au bas du
  tableau, plus rien n'est dans le carton, même si les articles portent une
  quantité et ressemblent en tout point à ceux du dessus. Ils sont extraits dans
  une liste séparée, jamais dans les lignes à scanner, et la seconde ligne y
  porte le motif (`A PARAITRE`, `EPUISE`) et non un complément de titre. Sans
  cette distinction, l'opérateur chercherait un livre absent et finirait avec un
  faux manque au récapitulatif.
- **Annotations manuscrites** (cercles du réceptionnaire autour des quantités) :
  le prompt impose de recopier l'imprimé, jamais le manuscrit.

Une ligne « vue par un seul moteur » se traite selon la raison. Si un seul moteur
a répondu pour toute la page, la lecture croisée n'a jamais eu lieu : la page est
marquée dégradée, un bandeau l'annonce, et rien ne bloque — bloquer là rouvrirait
tout le bon dès qu'un moteur ne répond pas, ce qui reviendrait à le ressaisir à
la main. La clé de contrôle reste le garde-fou sur l'ISBN.

Si les deux moteurs ont répondu et qu'un seul a vu la ligne, c'est un oubli franc
de l'autre sur une page qu'il a par ailleurs lue. Sa quantité n'a alors aucun
contradicteur, et c'est le genre d'écart qui finit en manque non détecté :
celle-là bloque.

### Le décalage d'un bloc, l'erreur qui ne se voit pas

Sur ces bordereaux, un article tient sur **deux lignes imprimées**, parfois
trois. La seconde ne porte jamais de quantité : elle porte l'ISBN, un éventuel
**complément de titre**, et l'éditeur tout à droite.

```
ARTICLES         QTE   LIBELLE
15 5974 9          1   LES AVENTURES D ARSENE LUPIN
9782011559746                LFF B1            H.EDU. F.L.E.
33 5449 1          2   CHINOIS TEL QU ON LE PARLE 2ED
9782200640354                                  DUNOD
84 8606 6          1   DELF B2 100 REUSSITE  2022  LIVRE  ONPRIN
9782278102549                LIVRE             DIDIER FLE
```

Deux façons de se tromper, toutes deux invisibles au scan :

- **Le décalage.** Un moteur qui glisse d'un cran rattache `9782200640354` aux
  `AVENTURES D ARSENE LUPIN` au lieu du `CHINOIS`. Le code existe bien dans le
  bon : le livre est simplement décompté sur la mauvaise ligne. Le carton part
  pour complet alors qu'il manque un titre et qu'il y en a un en trop.
- **Le complément pris pour un titre.** `LFF B1` ou `LIVRE` n'ont pas de
  quantité, ce sont des compléments. Un moteur qui en fait un article ouvre une
  ligne de trop — et décale les ISBN de tout ce qui suit.

Quatre mesures se cumulent contre ça :

1. **La quantité est l'ancre.** Le prompt décrit la structure en blocs avec deux
   exemples travaillés — un de chaque bordereau réel — et pose la règle
   mécaniquement : un nouvel article commence exactement là où une quantité est
   imprimée, et nulle part ailleurs. Toute ligne sans quantité est la suite de
   celle du dessus ; son ISBN appartient au titre au-dessus, jamais à celui du
   dessous. Les compléments sont ajoutés au titre, jamais traités à part.
2. **La référence interne sert d'ancre au rapprochement.** Elle est imprimée sur
   la ligne du titre, donc elle identifie le bloc même quand un moteur s'est
   trompé d'ISBN. Les deux lectures sont appariées par référence d'abord, par
   ISBN ensuite, par titre en dernier recours.
3. **Le contrôle d'alignement.** Quand les deux moteurs désignent le même bloc —
   même référence ou même ISBN — mais lui donnent deux titres qui n'ont rien à
   voir, ce n'est pas un titre mal lu, c'est un code rattaché au mauvais libellé.
   La ligne est signalée « ISBN sur 2 titres » et bloque, avec un rappel de la
   structure en deux lignes dans l'écran d'arbitrage.
4. **Le compte des références imprimé en pied de bordereau** (« ARTICLES: 19 »)
   est comparé au nombre de lignes lues. Plus de lignes que de références annoncées,
   c'est le signe qu'un complément est passé pour un titre — le seul contrôle qui
   attrape le cas où les deux moteurs se trompent pareil.

## Ce que la caméra lit — et ce qu'elle doit ignorer

Un livre validé sans feuille de saisie ne met pas l'écran en pause : l'opérateur
enchaîne. Mais pendant qu'il retire le livre du champ, l'objectif balaie la pile
posée à côté. L'écartement d'un code après lecture n'y changeait rien — il ne
couvre que *ce* code, et ce qui passe ensuite en est un autre. La feuille
« Absent du bon » s'ouvrait alors au milieu du geste, sur un livre jamais
présenté.

Deux mesures :

- **Une pause de 900 ms après chaque validation**, sur *tous* les codes.
  Un échange de livre prend bien plus longtemps, donc la cadence n'en souffre
  pas — et rien n'est perdu : la boucle continue de tourner, un livre présenté
  pendant la pause est lu dès qu'elle expire.
- **Une seconde lecture exigée pour tout ce qui n'est pas un livre.** Un code à
  préfixe Bookland (978/979) dont la clé tombe juste est accepté du premier
  coup : la conjonction des deux ne sort pas du bruit. Tout autre code —
  étiquette logistique, promotion collée sur la couverture, fragment attrapé de
  biais — doit être vu deux images de suite avant d'interrompre l'opérateur.
  Le surcoût se compte en dizaines de millisecondes, sur un cas rare.

## Ce que le navigateur ne permet pas

Trois limites de Safari sur iOS, connues et assumées :

- **Aucun retour haptique.** `navigator.vibrate` n'existe pas sur iOS. La
  confirmation repose sur le son et sur un **voile de couleur plein écran** —
  vert pour un livre compté, ambre pour une décision à prendre — assez large
  pour être perçu du coin de l'œil sans fixer l'écran.
- **Aucun contrôle de la torche.** Safari n'expose pas la contrainte `torch` :
  en entrepôt sombre, il faut passer par le centre de contrôle iOS.
- **Aucun recadrage automatique.** Pas d'équivalent VisionKit : les photos
  partent telles quelles. Mistral OCR est robuste à la perspective, mais une
  page bien à plat se lit mieux.

## Les données

Le carton en cours vit dans **IndexedDB**, sur l'appareil : l'état de la session
d'un côté, les photos des pages de l'autre. Tout est supprimé à la clôture.

La persistance sert uniquement à la reprise sur incident : si l'onglet est fermé
au 120ᵉ livre d'un carton de 200, l'app repart où elle en était. Une lecture OCR
interrompue, elle, ne peut pas reprendre — l'app revient à l'accueil plutôt que
de rester sur un écran figé.

L'export PDF + CSV est proposé au récapitulatif, avant la purge. Sur iOS il
passe par la feuille de partage native (mail, Fichiers, Drive, AirDrop).

**La clé Mistral ne quitte jamais le serveur.** Le navigateur appelle
`/api/ocr`, qui parle à Mistral avec la clé stockée en variable
d'environnement Vercel.

## Déploiement

```bash
npm install
cp .env.example .env.local   # renseigner les trois variables
npm run dev
```

Trois variables d'environnement, à définir en local puis dans Vercel
(*Settings → Environment Variables*) :

| Variable | Rôle |
|---|---|
| `MISTRAL_API_KEY` | Clé API Mistral, côté serveur uniquement. |
| `ACCESS_CODE` | Code partagé de l'équipe, demandé une fois par appareil. |
| `AUTH_SECRET` | Secret de signature du cookie de session. |

Générer le secret :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Deux variables facultatives, `MISTRAL_OCR_MODEL` et `MISTRAL_VISION_MODEL`,
permettent de changer de modèle sans toucher au code
(`mistral-ocr-latest` et `mistral-medium-latest` par défaut).

Le déploiement Vercel est standard : connecter le dépôt, aucune configuration
de build particulière.

### Sur le téléphone

Ouvrir l'URL dans Safari, saisir le code d'accès, puis **Partager → Sur l'écran
d'accueil**. L'app s'ouvre alors en plein écran, sans barre Safari.

L'accès caméra exige HTTPS — Vercel le fournit. En développement local sur un
téléphone, `http://` ne fonctionnera pas : passer par un tunnel HTTPS.

## Accès

Un code partagé unique, échangé contre un cookie signé HMAC valable un mois. Le
cookie est `httpOnly` et ne contient que sa date d'expiration et sa signature :
aucune session n'est stockée côté serveur.

Le but n'est pas de protéger des données sensibles — elles vivent sur l'appareil
de l'opérateur — mais d'empêcher qu'un inconnu tombant sur l'URL ne consomme le
crédit Mistral.

## Interface

L'interface suit le design system **Geist** de Vercel : police Geist Sans et
Geist Mono, surfaces plates séparées par un trait de 1 px plutôt que par des
ombres, un seul bouton plein par écran, aucune décoration. Les couleurs d'état
— vert, ambre, rouge — ne servent qu'à signaler une anomalie. Les thèmes clair
et sombre suivent le réglage du système.

Tous les nombres sont en chasse fixe et en chiffres tabulaires : sur un écran de
comptage, `12/20` doit rester aligné d'une ligne à l'autre.

Le code est revu contre les [Web Interface Guidelines de Vercel][wig],
installées comme skill d'agent dans `.agents/skills/` :

```bash
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
```

Ce qu'elles ont corrigé ici : blocage du zoom retiré du viewport,
`touch-action: manipulation` pour supprimer le délai du double-tap sans
désactiver le zoom, anneaux de focus clavier, libellés et `aria-label` sur les
champs et boutons-icônes, dimensions explicites sur les images,
`content-visibility` sur les listes longues, `translate="no"` sur les ISBN, et
fond de scène des dialogues rendu atteignable au clavier.

[wig]: https://github.com/vercel-labs/web-interface-guidelines

## Choix techniques

- **Next.js 16** (App Router) sur Vercel, **TypeScript**, **Tailwind CSS 4**.
- **Geist** pour la typographie, chargée via `next/font` (aucun décalage de mise
  en page au chargement).
- **ZXing** (`@zxing/browser`) pour les codes-barres : Safari n'implémente pas
  l'API `BarcodeDetector`. Les formats sont restreints aux symbologies du livre,
  ce qui augmente le nombre d'images analysées par seconde.
- **Zustand** + IndexedDB (`idb-keyval`) pour l'état du carton. `localStorage`
  ne conviendrait pas : quotas trop bas pour un bon de deux cents lignes, et
  écriture synchrone qui ferait tressauter l'écran de scan.
- **jsPDF** pour le récapitulatif, chargé à la demande.
- **Web Audio** pour les bips, avec des timbres distincts entre succès,
  attention et échec.

## Organisation

```
src/
├── app/
│   ├── page.tsx            Point d'entrée
│   └── api/
│       ├── ocr/            Double lecture Mistral (serveur)
│       └── session/        Code d'accès et cookie signé
├── server/                 Modules jamais envoyés au navigateur
│   ├── mistral.ts
│   └── auth.ts
├── lib/
│   ├── isbn.ts             Normalisation et clés de contrôle
│   ├── reconciler.ts       Croisement des deux lectures
│   ├── order.ts            Calculs d'écarts
│   ├── store.ts            État du carton (Zustand + IndexedDB)
│   ├── export.ts           PDF et CSV
│   ├── useBarcodeScanner.ts
│   ├── feedback.ts         Bips
│   ├── images.ts           Redimensionnement avant envoi
│   └── pages.ts            Photos des pages
└── components/             Un composant par phase
```

## Tester sans matériel

Avec `NEXT_PUBLIC_ENABLE_DEMO=1`, **Réglages → Charger un bon de démonstration**
injecte un bon fictif de 7 titres qui couvre les deux régimes : ce qui doit
remonter à l'opérateur — quantités divergentes, clé ISBN cassée, ISBN rattaché au
mauvais titre — et ce qui doit rester une simple mention — titre lu
différemment, ligne non recoupée, ISBN tranché par la clé. De quoi parcourir tout
le flux sans photo ni appel Mistral. À activer en local et sur les préversions,
jamais en production.

La logique métier — clés ISBN, rapprochement, consolidation — est couverte par
des assertions vérifiées : conversion ISBN-10 → 13, détection d'un chiffre faux
malgré l'accord des deux moteurs, arbitrage automatique entre une clé valide et
une clé cassée, divergence de quantité, décalage d'un bloc entre les deux
lectures, ligne manquée par un moteur, fusion des doublons.

## Limites connues

- Le corps d'une requête serverless Vercel est plafonné à quelques mégaoctets :
  les photos sont réduites à 2000 px et compressées avant envoi. La qualité JPEG
  est tenue à 0,85 et non plus 0,72 : ces bordereaux sortent d'une imprimante
  matricielle, et le rebond de quantification étalait les jambages d'un pixel au
  point de transformer un 3 en 8 — soit exactement les chiffres dont la clé de
  contrôle dépend.
- Une page très dense peut approcher la limite de durée d'une fonction Vercel
  (`maxDuration` est fixé à 60 s). L'app envoie **une page par requête**, ce qui
  garde chaque appel court même sur un bon de trente pages.
- L'app nécessite le réseau à chaque phase : il n'y a pas de service worker.
