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
| 3. Contrôle | Seules les lignes divergentes ou à ISBN invalide remontent, avec la photo de la page en regard pour trancher. |
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

**Rien n'est deviné.** Là où un doute subsiste, l'app ne tranche jamais à la
place de l'opérateur : elle affiche les deux lectures côte à côte, avec la photo
de la page, et attend l'arbitrage. Le bouton de validation reste désactivé tant
qu'il reste une ligne à vérifier.

Le prompt impose par ailleurs aux modèles de renvoyer une valeur vide plutôt que
de compléter de mémoire — un ISBN plausible mais inventé serait le pire des cas,
puisqu'il passerait la clé de contrôle.

Si un seul des deux moteurs répond, la lecture n'est pas bloquée : elle est
marquée dégradée, un bandeau l'annonce, et chaque ligne porte la mention
« source unique » à vérifier.

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
injecte un bon fictif de 7 titres contenant une divergence de lecture, une clé
ISBN cassée et une ligne à source unique. De quoi parcourir tout le flux sans
photo ni appel Mistral. À activer en local et sur les préversions, jamais en
production.

La logique métier — clés ISBN, rapprochement, consolidation — est couverte par
des assertions vérifiées : conversion ISBN-10 → 13, détection d'un chiffre faux
malgré l'accord des deux moteurs, divergence de quantité, ligne manquée par un
moteur, fusion des doublons.

## Limites connues

- Le corps d'une requête serverless Vercel est plafonné à quelques mégaoctets :
  les photos sont réduites à 2000 px et compressées avant envoi.
- Une page très dense peut approcher la limite de durée d'une fonction Vercel
  (`maxDuration` est fixé à 60 s). L'app envoie **une page par requête**, ce qui
  garde chaque appel court même sur un bon de trente pages.
- L'app nécessite le réseau à chaque phase : il n'y a pas de service worker.
