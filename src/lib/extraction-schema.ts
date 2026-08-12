/**
 * Schéma JSON strict imposé aux deux moteurs d'extraction, pour qu'ils
 * renvoient exactement la même forme et soient comparables champ à champ.
 *
 * Il est calé sur des bordereaux réels (SODIS/Gallimard, CDL Hachette), dont
 * la mise en page diffère fortement : ordre des colonnes, intitulés, présence
 * ou non d'une référence interne à côté de l'ISBN.
 */
const LINE_ITEM = {
  type: "object",
  properties: {
    reference: {
      type: "string",
      description:
        "Référence interne du distributeur imprimée dans la colonne article, sur la MÊME ligne que le titre et la quantité (« 19 9119 0 », « 85 5040 3 »). Recopie-la telle quelle, espaces compris. Chaîne vide si le bordereau n'en porte pas.",
    },
    isbn: {
      type: "string",
      description:
        "ISBN à 13 chiffres commençant par 978 ou 979, chiffres uniquement. Jamais une référence interne du distributeur. Il appartient au bloc dont la référence et le titre sont sur la ligne AU-DESSUS de lui.",
    },
    title: { type: "string", description: "Titre du livre, tel qu'imprimé." },
    publisher: {
      type: "string",
      description:
        "Éditeur ou collection, généralement en seconde ligne de la cellule de libellé (FOLIO, GALLIMARD JEUNE, GLENAT…). Chaîne vide si absent.",
    },
    quantity_ordered: {
      type: "integer",
      description:
        "Quantité commandée, seulement s'il existe une colonne distincte. Sinon, même valeur que quantity_delivered.",
    },
    quantity_delivered: {
      type: "integer",
      description:
        "Quantité effectivement livrée dans ce carton. Colonne « Qté » / « QTE ». Elle est imprimée sur la ligne du TITRE, pas sur celle de l'ISBN.",
    },
  },
  required: [
    "reference",
    "isbn",
    "title",
    "publisher",
    "quantity_ordered",
    "quantity_delivered",
  ],
  additionalProperties: false,
} as const;

export const EXTRACTION_SCHEMA = {
  type: "object",
  title: "DeliveryNotePage",
  properties: {
    supplier: {
      type: "string",
      description: "Nom du distributeur ou de l'éditeur émetteur. Chaîne vide si absent.",
    },
    reference: {
      type: "string",
      description: "Numéro de bordereau ou de livraison. Chaîne vide si absent.",
    },
    lines: {
      type: "array",
      description: "Une entrée par ligne de livre effectivement livrée, dans l'ordre du document.",
      items: LINE_ITEM,
    },
    not_delivered: {
      type: "array",
      description:
        "Articles d'une section « NON-SERVI », « MANQUANT » ou « Reliquat » : ils ne sont PAS dans le carton.",
      items: {
        type: "object",
        properties: {
          isbn: { type: "string", description: "ISBN, chiffres uniquement. Vide si absent." },
          title: { type: "string", description: "Titre. Chaîne vide si absent." },
          publisher: { type: "string", description: "Éditeur. Chaîne vide si absent." },
          quantity: { type: "integer", description: "Quantité non servie. 0 si absent." },
          reason: {
            type: "string",
            description:
              "Motif imprimé tel quel (« MANQUANT PAS NOTE », « épuisé », « à paraître »). Chaîne vide si absent.",
          },
        },
        required: ["isbn", "title", "publisher", "quantity", "reason"],
        additionalProperties: false,
      },
    },
    declared_total_quantity: {
      type: "integer",
      description:
        "Total d'exemplaires imprimé sur le document (« Qté : 45 », « QUANTITE : 7 »). 0 si absent.",
    },
    declared_total_articles: {
      type: "integer",
      description: "Nombre de références imprimé sur le document (« Nbre article(s) »). 0 si absent.",
    },
  },
  required: [
    "supplier",
    "reference",
    "lines",
    "not_delivered",
    "declared_total_quantity",
    "declared_total_articles",
  ],
  additionalProperties: false,
} as const;

export const EXTRACTION_INSTRUCTION = `Tu extrais le tableau d'un bordereau de livraison de livres, en français.

UN ARTICLE OCCUPE PLUSIEURS LIGNES IMPRIMÉES
C'est le point le plus important, et la source d'erreur la plus fréquente sur ces documents.

Un article n'est presque jamais sur une seule ligne. Il occupe un BLOC de deux lignes imprimées, parfois trois :
- Ligne 1 du bloc : la référence interne du distributeur, la quantité, et le TITRE.
- Ligne 2 du bloc : l'ISBN à 13 chiffres, et l'ÉDITEUR ou la collection.
- Ligne 3 éventuelle : une mention complémentaire (« NED », « ROMAN », « 2NDE ED »), rattachée au même bloc.

Exemple typique, colonne ARTICLE à gauche, QTE au milieu, LIBELLE à droite :

    ARTICLE          QTE   LIBELLE
    19 9119 0          1   COLORIAGES MYSTERES TABLEAUX DE MAITRES
    9782019462994                    HACHETTE HEROES
    30 1378 6          1   LES CHATIMENTS
    9782253016861                    LGF
                                     NED
    31 6304 5          1   JOURNAL D UN PARFUMEUR
    9782253163046                    LGF

Cela donne exactement trois articles :
1. reference « 19 9119 0 », isbn 9782019462994, title « COLORIAGES MYSTERES TABLEAUX DE MAITRES », publisher « HACHETTE HEROES », quantité 1.
2. reference « 30 1378 6 », isbn 9782253016861, title « LES CHATIMENTS », publisher « LGF », quantité 1.
3. reference « 31 6304 5 », isbn 9782253163046, title « JOURNAL D UN PARFUMEUR », publisher « LGF », quantité 1.

RÈGLE DE RATTACHEMENT — à appliquer littéralement
Un ISBN appartient TOUJOURS au titre situé sur la ligne juste AU-DESSUS de lui, jamais à celui du dessous.
Autrement dit : descends ligne par ligne. Dès que tu vois une ligne qui porte une référence interne, une quantité et un titre, tu ouvres un nouvel article. L'ISBN et l'éditeur que tu rencontres ENSUITE, avant le titre suivant, appartiennent à cet article-là.
Ne jamais décaler d'un cran. 9782253016861 va avec « LES CHATIMENTS », pas avec « COLORIAGES MYSTERES » ni avec « JOURNAL D UN PARFUMEUR ».

CONTRÔLE AVANT DE RÉPONDRE
Compte les titres, les ISBN et les quantités : il doit y en avoir autant. Si un article se retrouve sans ISBN pendant qu'un autre en a deux, c'est que tu as décalé un bloc — reprends l'appariement depuis le haut du tableau.

REPÉRAGE DES COLONNES
Ces bordereaux varient fortement d'un distributeur à l'autre : l'ordre des colonnes, leurs intitulés et la mise en page changent. Repère chaque colonne par son sens, jamais par sa position.

- \`reference\` : la référence interne du distributeur, sur la ligne du titre. Elle est plus courte que l'ISBN et souvent espacée (« 20 3087 8 », « 45 0505 0 », « 86 1177 2 »). Recopie-la dans ce champ, espaces compris. Chaîne vide si le bordereau n'en imprime pas.
- \`isbn\` : le code à 13 chiffres commençant par 978 ou 979. Il n'est JAMAIS la référence interne : celle-ci ne va pas dans ce champ.
- \`title\` : colonne « Libellé », « LIBELLE », « Désignation » ou « Titre ». Première ligne du bloc.
- \`publisher\` : la seconde ligne de la cellule de libellé porte presque toujours l'éditeur ou la collection (FOLIO, GALLIMARD JEUNE, MAPAR, GLENAT, HACHETTE HEROES, LIV.POCHE JEUNE…). C'est cela qu'il faut renvoyer. Ce n'est PAS un auteur, et il ne faut jamais deviner un auteur. Chaîne vide si rien n'est imprimé.
- \`quantity_delivered\` : colonne « Qté », « QTE », « Quantité », « Servi » ou « Livré ». C'est le nombre d'exemplaires censés être physiquement dans le carton. Elle est imprimée sur la ligne du titre : ne la lis pas sur la ligne de l'ISBN, où cette colonne est vide.
- \`quantity_ordered\` : uniquement s'il existe une colonne distincte « Commandé » ou « Cdé ». Sinon, recopie la même valeur que quantity_delivered.

Attention : une quantité manquante n'est jamais implicite. Si la case est vide sur la ligne du titre, mets 0 — ne recopie pas la quantité de l'article précédent.

ARTICLES NON SERVIS
Certains bordereaux comportent une section séparée, sous un titre du genre « NON-SERVI DE VOTRE LIVRAISON », « NON SERVI », « MANQUANT », « Reliquat » ou « Reste à livrer ». Ces articles ne sont PAS dans le carton.
Ne les place jamais dans \`lines\`. Mets-les dans \`not_delivered\`, avec le motif imprimé s'il y en a un.

TOTAUX
Si le document imprime un total d'exemplaires ou de références (« Qté : 45 », « QUANTITE : 7 », « Nbre article(s) : 36 », « ARTICLES 3 »), recopie ces nombres dans declared_total_quantity et declared_total_articles. Sinon 0.

RÈGLES IMPÉRATIVES
- Une entrée par article imprimé, dans l'ordre du document.
- N'invente jamais une valeur. Cellule vide, illisible ou barrée → chaîne vide, ou 0.
- Ne complète pas un ISBN de mémoire : recopie strictement les chiffres visibles, sans corriger la clé de contrôle. Une lecture fidèle mais fausse est utile ; une lecture « réparée » ne l'est pas.
- \`isbn\` : chiffres uniquement, tirets et espaces retirés.
- Ignore les en-têtes, pieds de page, mentions légales, adresses, lignes de TVA, de sous-total et de port.
- Les annotations manuscrites — cercles, coches, croix, ratures — sont les marques du réceptionnaire. Elles ne modifient jamais les chiffres imprimés : recopie l'imprimé.`;
