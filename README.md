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
| 2. Lecture | Chaque page passe dans l'**endpoint OCR documentaire de Mistral**, côté serveur, sous un schéma JSON strict. |
| 3. Contrôle | Seules les lignes dont l'**ISBN ou la quantité** restent douteux remontent, avec la photo de la page en regard pour trancher. |
| 4. Scan | Caméra en continu. Un exemplaire attendu → flash bref, vert (special order) ou bleu (autre commande), sans nom de commande affiché. Plusieurs exemplaires, ou titre déjà complet → feuille de saisie, avec la répartition par commande. |
| 5. Clôture | Manques, surplus, abîmés, hors commande. Récapitulatif PDF, liste d'import CSV — téléchargeable ou envoyée par mail — puis **purge totale**. |

## La fiabilité de lecture

C'est le point critique : une erreur d'OCR sur un ISBN ou une quantité passe
directement en litige fournisseur.

**Une seule lecture, par l'endpoint OCR documentaire.** Chaque page part avec un
schéma JSON strict qui impose la forme de la réponse. Un modèle vision a
longtemps fourni une seconde lecture à confronter champ à champ ; l'OCR s'étant
montré fiable sur ces bordereaux, le second appel ne payait plus son temps
d'attente ni sa note d'API. Ce qui reste sont les contrôles qui se démontrent
sans second avis.

L'endpoint OCR ne prend aucune consigne libre : il ne reçoit que le schéma. Les
règles de découpage vivent donc **dans le schéma lui-même**, portées par sa
`description` — exemple travaillé et contrôle de cohérence compris. C'est le
seul canal qui atteigne le moteur.

**Clé de contrôle ISBN.** Tout ISBN est validé par sa clé (EAN-13 ou ISBN-10,
converti en 13). Un chiffre mal lu casse la clé dans 9 cas sur 10 : c'est une
certitude arithmétique, pas une opinion, et c'est ce qui protège le champ dont
dépend l'identification au scan.

**Ce qui n'est plus couvert, et il faut le dire.** Une quantité mal lue n'a plus
de contradicteur. Si l'OCR lit 2 là où le bordereau porte 3, le carton se
clôture sur un excédent d'un exemplaire, sans alerte. C'est la contrepartie
assumée de la lecture unique.

**Rien n'est deviné pour autant.** Le schéma interdit de compléter un ISBN de
mémoire ou d'en corriger la clé : une lecture fidèle mais fausse est utile,
puisque la clé la démasque, alors qu'une lecture « réparée » passe pour juste.
Le bouton de validation reste désactivé tant qu'il reste une ligne à trancher.

**Deux familles arrêtent l'opérateur, et deux seulement :**

1. **un ISBN faux, absent, ou posé sur deux titres sans rapport** — clé cassée,
   champ vide, ou même code retrouvé sur deux libellés étrangers l'un à l'autre
   une fois les pages réunies ;
2. **une quantité absente** — aucune case remplie sur la ligne du titre.

Tout le reste s'affiche sur la ligne, corrigeable, sans entrer dans la file :
titre non lu, doublon d'ISBN fusionné, série dont les tomes partagent un
libellé. Une file qui contient tout ne se distingue pas d'une file vide : on
finit par tout valider sans regarder.

**Les variantes se vérifient, elles n'arrêtent pas.** Un même titre porté par
plusieurs ISBN est le cas courant d'une série — trois tomes édités sous un
libellé rigoureusement identique — ou d'un livre façonné en deux versions. Ces
lignes vont dans un bloc à part, « Vérifier les variantes », groupé par titre,
qui ne bloque pas le passage au scan. La validation s'y fait **ISBN par ISBN** :
les libellés étant souvent identiques au caractère près, seul le code distingue
les tomes, et un bouton par groupe reviendrait à ne rien vérifier.

**Les colonnes doivent se répondre.** Trois contrôles ne portent pas sur la
lecture d'un champ mais sur le lien entre l'ISBN et le titre — le lien qui décide
quel livre sera décompté sur quelle ligne. Ceux-là bloquent, alors qu'une simple
divergence d'orthographe ne bloque pas :

- **tout ISBN a un titre.** Sans lui, l'écran de scan annonce un livre que
  l'opérateur ne peut pas reconnaître — signalé, sans bloquer : l'ISBN suffit à
  compter ;
- **un titre ne porte qu'un ISBN.** Le même libellé sur deux codes est le plus
  souvent une série ; c'est parfois un bloc recopié pendant qu'un autre perdait
  le sien. D'où une vérification, pas un arrêt ;
- **un ISBN ne porte qu'un sujet.** Deux lignes de même code aux titres sans
  rapport, ce n'est pas un doublon : c'est un rattachement faux d'un côté, et
  celui-là bloque.

La comparaison des titres se fait à l'identique, jamais par ressemblance :
`DRUUNA T01` et `DRUUNA T02` se ressemblent à 90 % et sont deux livres.

**Un ISBN, une ligne.** Le même ISBN vu deux fois n'est pas une commande de deux
lots : c'est le même bloc du bordereau lu deux fois. Les lignes sont réunies sans
rien demander, et l'app garde **la plus grande** quantité des deux, jamais leur
somme — additionner ferait chercher un exemplaire qui n'existe pas, et le carton
finirait en manque imaginaire.

**Le total imprimé n'est pas recoupé.** Le récapitulatif de pied de bordereau a
servi un temps à contrôler la somme des lignes lues. Ce contrôle a été retiré :
il couvre l'expédition entière, souvent plusieurs colis (« Nbre colis : 2 »),
alors que le carton en main n'en est qu'un — l'écart se déclenchait sur des
lectures parfaitement justes. Une alarme qui se trompe souvent apprend à ignorer
toutes les alarmes, y compris la clé ISBN, qui elle est fiable. Les totaux sont
toujours extraits et conservés, à titre de référence.

Le schéma impose par ailleurs au moteur de renvoyer une valeur vide plutôt que
de compléter de mémoire — un ISBN plausible mais inventé serait le pire des cas,
puisqu'il passerait la clé de contrôle.

### Ce que le schéma tient compte des bordereaux réels

Le schéma d'extraction est calé sur des bordereaux SODIS/Gallimard et CDL
Hachette, dont les mises en page n'ont rien de commun :

- **Pas de colonne « auteur ».** La seconde ligne de la cellule de libellé porte
  l'**éditeur ou la collection** (`FOLIO`, `GALLIMARD JEUNE`, `GLENAT`,
  `HACHETTE HEROES`). Demander un auteur ferait inventer une colonne qui
  n'existe pas.
- **Une seule colonne de quantité** le plus souvent (`Qté`, `QTE`). Le champ
  « commandé » n'est renseigné que si une colonne distincte existe.
- **Un article occupe un bloc de deux lignes imprimées**, parfois trois. La
  première porte la référence interne, la quantité et le titre ; la seconde
  porte l'ISBN, un éventuel complément de titre (`LFF B1`, `NED`, `LE AUDIO`) et
  l'éditeur. Voir plus bas : c'est la principale source d'erreur de ces
  documents.
- **Références internes du distributeur** mêlées aux ISBN dans la même colonne
  (`20 3087 8`, `45 0505 0`). Le prompt les exclut du champ `isbn` et les
  extrait dans un champ `reference` à part, seul repère qui reste sur le papier
  quand l'ISBN est mal lu.
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

- **Le décalage.** Une lecture qui glisse d'un cran rattache `9782200640354` aux
  `AVENTURES D ARSENE LUPIN` au lieu du `CHINOIS`. Le code existe bien dans le
  bon : le livre est simplement décompté sur la mauvaise ligne. Le carton part
  pour complet alors qu'il manque un titre et qu'il y en a un en trop.
- **Le complément pris pour un titre.** `LFF B1` ou `LIVRE` n'ont pas de
  quantité, ce sont des compléments. En faire un article ouvre une ligne de trop
  — et décale les ISBN de tout ce qui suit.

Trois mesures se cumulent contre ça :

1. **La quantité est l'ancre.** La description du schéma pose la règle
   mécaniquement, exemple travaillé à l'appui : un nouvel article commence
   exactement là où une quantité est imprimée, et nulle part ailleurs. Toute
   ligne sans quantité est la suite de celle du dessus ; son ISBN appartient au
   titre au-dessus, jamais à celui du dessous. Les compléments sont ajoutés au
   titre, jamais traités à part.
2. **Le contrôle de cohérence, exigé avant la réponse.** Autant d'articles que
   de quantités imprimées, autant d'ISBN que d'articles. Plus d'articles que de
   quantités, un complément est passé pour un titre ; un article sans ISBN
   pendant qu'un autre en a deux, un bloc a été décalé. Dans les deux cas, le
   schéma demande de reprendre l'appariement depuis le haut du tableau.
3. **Le contrôle d'alignement, une fois les pages réunies.** Deux lignes portant
   le même ISBN sur des titres qui n'ont rien à voir ne sont pas un doublon :
   c'est un code rattaché au mauvais libellé. La ligne est signalée « ISBN sur 2
   titres » et bloque, avec un rappel de la structure en deux lignes dans
   l'écran d'arbitrage.

## À quelle commande appartient ce livre ?

Un carton fournisseur sert plusieurs commandes clients à la fois. Savoir qu'un
livre est bien dans le carton ne dit donc pas encore où il doit partir.

À chaque scan, une fois le titre retrouvé sur le bon de livraison, l'application
interroge un référentiel de commandes par ISBN et affiche ce qu'il en dit :
quelles commandes attendent ce titre, pour quel client, en quelle quantité.

**La cadence prime sur l'affichage** : le nom de la commande de destination ne
se voit plus au moment du scan, seulement au récapitulatif du carton et sur la
fiche du livre. Sa couleur, en revanche, se voit — c'est la seule information
que le flash donne sur la commande : **vert pour une special order** (une
référence qui se termine par `SP`, voir `isSpecialOrder` dans `lib/order.ts`),
**bleu pour une autre commande**. Deux cas, deux écrans :

- **un exemplaire attendu**, le cas de l'immense majorité des lignes : il n'y a
  aucune quantité à trancher, donc aucune saisie à ouvrir. La recherche en base
  (quelques centaines de millisecondes, la route `/api/orders` étant
  colocalisée avec Supabase à Paris) se fait sans rien afficher, puis un flash
  plein écran — vert ou bleu selon la commande — annonce le titre, sans nom de
  commande ni bouton : il s'efface tout seul, comme n'importe quel autre livre
  compté. Si plusieurs commandes se disputent le titre, la répartition ne peut
  pas se deviner : la feuille de saisie s'ouvre à la place.
- **plusieurs exemplaires attendus, ou un titre déjà complet qui repasse** : là
  il y a une quantité à vérifier, et la feuille de saisie s'ouvre avec son
  compteur, sa répartition par commande et ses exemplaires abîmés. Le flash qui
  suit la confirmation reprend le même code couleur ; un écart de quantité
  reste rouge, prioritaire sur la couleur de commande.

Un livre reste toujours rattrapable après coup : le bouton « Signaler abîmé »
de l'écran de scan porte sur le dernier titre compté.

**Un même ISBN peut appartenir à plusieurs commandes**, et c'est le cas qui
justifie tout le mécanisme. Deux libraires ont commandé le même titre :
l'application ne peut pas deviner à qui revient l'exemplaire qu'on tient. Elle
liste donc les commandes concernées avec ce qu'il leur reste à servir, propose
une répartition — la plus en attente d'abord — et laisse trancher. Un exemplaire
mal aiguillé part chez le mauvais client sans que rien ne le signale ensuite.

La proposition suit le compteur tant que l'opérateur n'y a pas touché : passer
de 1 à 2 exemplaires sert un second livre. Dès qu'il a réparti à la main, son
choix ne bouge plus.

**Un ISBN absent du référentiel n'est pas une anomalie.** Les commandes qui y
figurent ne couvrent qu'une partie du catalogue ; le reste relève d'une autre
catégorie de produits, servie par les commandes journalières. L'écran l'annonce
en toutes lettres — « Pour commandes journalières » — et l'exemplaire est
affecté à ce libellé, qui se regroupe au récapitulatif comme n'importe quelle
commande. Le dire franchement évite de chercher une anomalie qui n'existe pas.

**Le référentiel est consulté, jamais écrit.** Les affectations décidées au scan
vivent dans le carton, sur l'appareil, et repartent au récapitulatif — par
commande, avec le détail des ISBN. Une base qui n'est jamais écrite ne peut pas
être corrompue par un carton mal clôturé.

Rien de tout cela n'atteint le navigateur : il appelle `/api/orders` avec un
ISBN, et c'est le serveur qui interroge Supabase. Le détail du verrouillage —
schéma non exposé, RLS fermée, fonction unique en lecture — est dans
`supabase/README.md`, avec la marche à suivre pour créer le projet et importer
le tableur.

Quand le référentiel ne répond pas, le comptage continue : la ligne affiche
l'erreur, propose de réessayer, et la validation reste possible — le livre est
alors compté sans commande. Une panne de réseau ne doit pas arrêter une
réception.

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

L'export est proposé au récapitulatif, avant la purge. Sur iOS il passe par la
feuille de partage native (mail, Fichiers, Drive, AirDrop).

**Deux fichiers, deux usages qui n'ont rien à voir.**

Le **PDF** est la trace de la réception, à joindre à une réclamation
fournisseur : manques, surplus, abîmés, non servis, reliquats.

Le **CSV** est une liste d'import pour Librisoft, et rien d'autre. La liste
mémorisée se charge depuis un fichier portant « le code ISBN des articles puis
la quantité » — donc deux colonnes, dans cet ordre, aucune ligne d'en-tête (elle
serait lue comme un article), point-virgule, treize chiffres collés, et pas de
BOM UTF-8, qui se retrouverait collé au premier chiffre du premier ISBN.

```
9782854288520;1
9782854287066;2
```

N'y figure que ce qui est bon dans le carton : le comptage **moins** les
exemplaires signalés abîmés, qui partent en réclamation. Ce qui n'a jamais été
scanné n'y est pas — un manque est une absence, pas une entrée à zéro. Les deux
cas de bord sont tranchés dans le même sens, *ce qui a été scanné est ce qui est
là* : le surplus entre en stock, le livre hors bon n'entre pas, son ISBN n'ayant
été confronté à aucune ligne écrite. Un fichier d'import n'est pas un rapport :
la moindre ligne parasite entre en stock comme les autres.

Le même CSV part par mail en un geste, d'une adresse personnelle vérifiée chez
Resend vers celle du service commercial, avec pour objet
« csv commande n°*référence* ». Le fichier est expédié par le
serveur : `mailto:` ne sait pas joindre de pièce, et la feuille de partage iOS
ne sait pas pré-remplir un destinataire. C'est aussi ce qui permet à l'adresse
d'être écrite côté serveur, hors d'atteinte du navigateur — la route ne la lit
jamais de la requête, sans quoi elle serait un relais ouvert derrière un simple
code partagé. Le contenu envoyé est vérifié ligne à ligne contre la forme exacte
du fichier d'import, ce qui lui interdit de servir à autre chose.

**Les clés ne quittent jamais le serveur.** Le navigateur appelle `/api/ocr` et
`/api/mail`, qui parlent à Mistral et à Resend avec des clés stockées en
variables d'environnement Vercel.

## Déploiement

```bash
npm install
cp .env.example .env.local   # renseigner les trois variables
npm run dev
```

Trois variables d'environnement obligatoires, à définir en local puis dans
Vercel (*Settings → Environment Variables*) :

| Variable | Rôle |
|---|---|
| `MISTRAL_API_KEY` | Clé API Mistral, côté serveur uniquement. |
| `ACCESS_CODE` | Code partagé de l'équipe, demandé une fois par appareil. |
| `AUTH_SECRET` | Secret de signature du cookie de session. |

Générer le secret :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Trois variables facultatives :

| Variable | Rôle |
|---|---|
| `MISTRAL_OCR_MODEL` | Modèle de lecture (`mistral-ocr-latest` par défaut). |
| `RESEND_API_KEY` | Active « Envoyer le CSV par mail ». |
| `MAIL_FROM` | Adresse d'expédition. Obligatoire dès que le mail est activé, sans valeur par défaut. |
| `SUPABASE_URL` | Projet du référentiel de commandes. |
| `SUPABASE_SECRET_KEY` | Clé **secrète** du projet. Voir `supabase/README.md`. |
| `RESEND_WEBHOOK_SECRET` | Signature du webhook de réception (`whsec_…`). Active le dépôt d'une commande par courriel. |

Les deux vont ensemble : sans l'une ou l'autre, le bouton répond laquelle
manque plutôt que d'échouer sans raison lisible.

L'expédition part d'un **compte Resend personnel**, et Resend n'accepte qu'une
adresse appartenant à un domaine vérifié dans ce compte-là. `MAIL_FROM` est donc
l'adresse de ce domaine personnel — elle n'a aucun rapport avec celle du
destinataire, et rien n'est deviné à sa place : une adresse par défaut ferait
échouer chaque envoi sur un refus de l'API sans dire lequel des deux réglages
est en cause.

Le destinataire, lui, n'est pas une variable : il est écrit dans
`src/server/mail.ts`.

Le déploiement Vercel est standard : connecter le dépôt, aucune configuration
de build particulière. `/api/orders` épingle sa région (`preferredRegion =
"cdg1"`, Paris) pour rester à côté du projet Supabase (`eu-west-3`) — c'est du
code, rien à régler côté Vercel.

### Déposer une commande par courriel

Le référentiel s'alimente de deux façons : l'écran « Ajouter une commande » des
réglages, et une adresse de réception à qui l'on transfère le fichier du
fournisseur. Le second chemin fait le même travail que le premier, sans
téléphone.

Mise en place, côté Resend : activer la réception (Emails → Receiving), créer un
webhook sur l'événement `email.received` pointant vers
`https://<domaine>/api/orders/inbound`, et reporter le secret `whsec_…` dans
`RESEND_WEBHOOK_SECRET`.

Ce qui distingue ce chemin de l'écran tient en une phrase : **personne ne relit
avant que ça n'entre en base**. D'où trois règles qui n'ont pas cours ailleurs :

- **l'en-tête est exigé au caractère près**, jamais deviné. Ce n'est pas une
  précaution de principe : sur les 58 fichiers du premier lot, 25 sont sortis du
  même logiciel *sans la colonne `Code`*, donc sans ISBN. C'est le refus le plus
  fréquent, et le courriel de retour nomme la colonne manquante.
- **un seul expéditeur est autorisé**, écrit dans `src/server/inbound.ts`. Il
  n'authentifie personne — Resend ne rapporte ni SPF ni DKIM, donc une adresse
  d'origine reste déclarative. C'est une barrière contre l'erreur et le courrier
  de passage, pas contre quelqu'un qui vise.
- **un compte rendu part dans tous les cas**, réussite comprise. C'est ce qui
  compense le point précédent : un dépôt illégitime est visible dans la minute.
  Et sans lui, l'absence de message serait ambiguë — dépôt abouti, ou courriel
  perdu en route ? Le silence ne peut pas vouloir dire deux choses opposées.

Le nom du fichier donne la référence de la commande, l'objet du message donne le
nom affiché au scan. Un dépôt qui entre de travers se défait par
`select public.delete_order_lines('<référence>');`.

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
- **zxing-wasm** pour les codes-barres : Safari n'implémente pas l'API
  `BarcodeDetector`. C'est zxing-cpp compilé en WebAssembly — sur une image sans
  code, le cas qui domine la boucle, il rend la main en 1,8 ms là où le portage
  JavaScript en demandait 7,0. Ce dernier (`@zxing/library`) reste en secours si
  le WebAssembly ne se charge pas. Les formats sont restreints aux symbologies
  du livre.
- **Zustand** + IndexedDB (`idb-keyval`) pour l'état du carton. `localStorage`
  ne conviendrait pas : quotas trop bas pour un bon de deux cents lignes, et
  écriture synchrone qui ferait tressauter l'écran de scan.
- **jsPDF** pour le récapitulatif, chargé à la demande.
- **Resend** pour l'envoi du CSV, appelé en HTTP depuis la route serveur : pas
  de dépendance ajoutée, pas de connexion SMTP à tenir ouverte en serverless.
- **Web Audio** pour les bips, avec des timbres distincts entre succès,
  attention et échec.

## Organisation

```
src/
├── app/
│   ├── page.tsx            Point d'entrée
│   └── api/
│       ├── ocr/            Lecture Mistral (serveur)
│       ├── orders/         Recherche de commande par ISBN (serveur)
│       ├── mail/           Envoi du CSV (serveur)
│       └── session/        Code d'accès et cookie signé
├── server/                 Modules jamais envoyés au navigateur
│   ├── mistral.ts
│   ├── orders.ts
│   ├── mail.ts
│   └── auth.ts
├── lib/
│   ├── isbn.ts             Normalisation et clés de contrôle
│   ├── reconciler.ts       Lecture en lignes, contrôles, consolidation
│   ├── order.ts            Calculs d'écarts
│   ├── store.ts            État du carton (Zustand + IndexedDB)
│   ├── orders.ts           Appel de /api/orders depuis le navigateur
│   ├── export.ts           PDF, CSV d'import, envoi par mail
│   ├── useBarcodeScanner.ts
│   ├── feedback.ts         Bips
│   ├── images.ts           Redimensionnement avant envoi
│   └── pages.ts            Photos des pages
└── components/             Un composant par phase
```

Le schéma SQL du référentiel et sa marche à suivre sont dans `supabase/`.

## Tester sans matériel

Avec `NEXT_PUBLIC_ENABLE_DEMO=1`, **Réglages → Charger un bon de démonstration**
injecte un bon fictif de 7 titres qui couvre les deux régimes : ce qui doit
remonter à l'opérateur — clé ISBN cassée, ISBN rattaché au mauvais titre — et ce
qui doit rester une simple mention : doublon fusionné, série dont les tomes
partagent un libellé. De quoi parcourir tout le flux sans photo ni appel
Mistral. À activer en local et sur les préversions, jamais en production.

La logique métier est couverte par des assertions vérifiées : conversion
ISBN-10 → 13, détection d'un chiffre faux, quantité reportée quand la colonne
« commandé » manque, décalage d'un bloc, fusion des doublons d'ISBN, variantes
validées une par une, forme exacte du fichier d'import — deux colonnes, pas
d'en-tête, pas de BOM, manquants et abîmés écartés — répartition proposée entre
plusieurs commandes, et décompte par client au récapitulatif.

## Limites connues

- Le corps d'une requête serverless Vercel est plafonné à quelques mégaoctets :
  les photos sont réduites à 2400 px sur le grand côté et compressées avant
  envoi. Ce plafond arbitre entre ce que le papier contient et ce qu'on paie
  pour l'atteindre : le nombre de pixels varie à son carré. Les bordereaux sont
  imprimés à 10 caractères par pouce, et comme les pages sont photographiées et
  non scannées — une bonne part du cadre est du bureau — la feuille n'en
  récupère que les deux tiers, soit environ 14 px par caractère. C'est la limite
  basse de ce qu'un OCR lit proprement ; 2000 px passait en dessous.
- La qualité JPEG est tenue à 0,85 et non 0,72 : ces bordereaux sortent d'une
  imprimante matricielle, et le rebond de quantification étalait les jambages
  d'un pixel au point de transformer un 3 en 8 — soit exactement les chiffres
  dont la clé de contrôle dépend.
- Une page très dense peut approcher la limite de durée d'une fonction Vercel
  (`maxDuration` est fixé à 60 s). L'app envoie **une page par requête**, ce qui
  garde chaque appel court même sur un bon de trente pages.
- L'app nécessite le réseau à chaque phase : il n'y a pas de service worker.
