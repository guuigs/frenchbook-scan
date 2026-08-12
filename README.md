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

**Seules l'identité et le comptage arrêtent l'opérateur.** L'ISBN identifie le
livre au scan, les quantités disent combien doivent sortir du carton : ce sont
les seules colonnes qui bloquent. Un titre ou un éditeur lus différemment par les
deux moteurs sont affichés sur la ligne et corrigeables, mais ne font plus partie
de la file d'attente — ils ne changent rien à ce qu'il y a à compter. Une file
qui contient tout ne se distingue pas d'une file vide : on finit par tout valider
sans regarder.

**Contrôle du total imprimé.** Quand le bordereau porte un total d'exemplaires
(« Qté : 45 », « QUANTITE : 7 »), l'app le compare à la somme des lignes lues.
C'est le seul contrôle capable de détecter une ligne entière sautée par les deux
moteurs à la fois — la double lecture, elle, ne voit rien quand ils omettent la
même chose. L'avertissement est indicatif et non bloquant : sur un bordereau
multi-échéances, le total imprimé couvre souvent plus que les pages
photographiées.

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
  porte l'ISBN et l'éditeur. Voir plus bas : c'est la principale source
  d'erreur de ces documents.
- **Références internes du distributeur** mêlées aux ISBN dans la même colonne
  (`20 3087 8`, `45 0505 0`). Le prompt les exclut du champ `isbn` et les
  extrait dans un champ `reference` à part, où elles servent de seconde clé
  d'appariement entre les deux lectures.
- **Section « NON-SERVI DE VOTRE LIVRAISON »** : ces articles ne sont pas dans
  le carton. Ils sont extraits dans une liste séparée, jamais dans les lignes à
  scanner. Sans cette distinction, l'opérateur chercherait un livre absent et
  finirait avec un faux manque au récapitulatif.
- **Annotations manuscrites** (cercles du réceptionnaire autour des quantités) :
  le prompt impose de recopier l'imprimé, jamais le manuscrit.

Si un seul des deux moteurs répond, la lecture n'est pas bloquée : elle est
marquée dégradée, un bandeau l'annonce, et chaque ligne porte la mention
« source unique ». Ces lignes ne bloquent pas — bloquer ici rouvrirait tout le
bon dès qu'un moteur ne répond pas, ce qui reviendrait à le ressaisir à la main.
La clé de contrôle reste le garde-fou sur l'ISBN.

### Le décalage d'un bloc, l'erreur qui ne se voit pas

Sur ces bordereaux, chaque article tient sur **deux lignes imprimées** :

```
ARTICLE          QTE   LIBELLE
19 9119 0          1   COLORIAGES MYSTERES TABLEAUX DE MAITRES
9782019462994                    HACHETTE HEROES
30 1378 6          1   LES CHATIMENTS
9782253016861                    LGF
                                 NED
```

Un moteur qui glisse d'un cran rattache `9782253016861` à `COLORIAGES MYSTERES`
au lieu de `LES CHATIMENTS`. L'erreur est invisible au scan : le code existe bien
dans le bon, le livre est simplement décompté sur la mauvaise ligne. Le carton
part pour complet alors qu'il manque un titre et qu'il y en a un en trop.

Trois mesures se cumulent contre ça :

1. **Le prompt décrit la structure en blocs** avec un exemple travaillé, et pose
   la règle littéralement : un ISBN appartient toujours au titre de la ligne
   **au-dessus** de lui, jamais à celle du dessous. Il demande enfin de vérifier
   qu'il y a autant de titres que d'ISBN et de quantités avant de répondre.
2. **La référence interne sert d'ancre.** Elle est imprimée sur la ligne du
   titre, donc elle identifie le bloc même quand un moteur s'est trompé d'ISBN.
   Les deux lectures sont appariées par référence d'abord, par ISBN ensuite,
   par titre en dernier recours.
3. **Le contrôle d'alignement.** Quand les deux moteurs désignent le même bloc —
   même référence ou même ISBN — mais lui donnent deux titres qui n'ont rien à
   voir, ce n'est pas un titre mal lu, c'est un code rattaché au mauvais libellé.
   La ligne est signalée « ISBN/titre décalés » et bloque, avec un rappel de la
   structure en deux lignes dans l'écran d'arbitrage.

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
  les photos sont réduites à 2000 px et compressées avant envoi.
- Une page très dense peut approcher la limite de durée d'une fonction Vercel
  (`maxDuration` est fixé à 60 s). L'app envoie **une page par requête**, ce qui
  garde chaque appel court même sur un bon de trente pages.
- L'app nécessite le réseau à chaque phase : il n'y a pas de service worker.
