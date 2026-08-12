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
        "ISBN à 13 chiffres commençant par 978 ou 979, chiffres uniquement. Jamais une référence interne du distributeur. Il appartient à l'article dont la quantité et le titre sont sur la ligne AU-DESSUS de lui.",
    },
    title: {
      type: "string",
      description:
        "Titre du livre, tel qu'imprimé sur la ligne qui porte la quantité, suivi des compléments des lignes sans quantité qui le suivent (« LFF B1 », « NED », « LE AUDIO »), séparés par une espace.",
    },
    publisher: {
      type: "string",
      description:
        "Éditeur ou collection : le bloc de texte le plus à droite de la cellule de libellé, en seconde ligne (FOLIO, DUNOD, DIDIER FLE, H.EDU. F.L.E.…). Ce n'est pas le complément de titre, qui est plus à gauche. Chaîne vide si absent.",
    },
    quantity_ordered: {
      type: "integer",
      description:
        "Quantité commandée, seulement s'il existe une colonne distincte. Sinon, même valeur que quantity_delivered.",
    },
    quantity_delivered: {
      type: "integer",
      description:
        "Quantité effectivement livrée dans ce carton. Colonne « Qté » / « QTE ». Elle est imprimée sur la ligne du TITRE, jamais sur celle de l'ISBN. C'est elle qui marque le début d'un article : autant d'articles que de quantités imprimées.",
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
- Ligne 1 du bloc : la référence interne du distributeur, LA QUANTITÉ, et le TITRE. Les trois sont sur la même ligne, alignés horizontalement.
- Ligne 2 du bloc : l'ISBN à 13 chiffres, éventuellement un COMPLÉMENT de titre, et l'ÉDITEUR ou la collection. Cette ligne n'a JAMAIS de quantité.
- Ligne 3 éventuelle : une autre mention complémentaire, toujours sans quantité.

LA QUANTITÉ EST L'ANCRE — c'est la règle à appliquer, littéralement
Un nouvel article commence exactement là où une quantité est imprimée dans la colonne QTE, et nulle part ailleurs.
Toute ligne SANS quantité est la suite de l'article du dessus : son ISBN, son complément et son éditeur appartiennent à cet article-là.
Donc : un ISBN appartient TOUJOURS au titre de la ligne portant une quantité située juste AU-DESSUS de lui. Jamais à celui du dessous.

Exemple 1, colonne ARTICLES à gauche, QTE au milieu, LIBELLE à droite :

    ARTICLES         QTE   LIBELLE
    19 9119 0          1   COLORIAGES MYSTERES TABLEAUX DE MAITRES
    9782019462994                    HACHETTE HEROES
    30 1378 6          1   LES CHATIMENTS
    9782253016861                    LGF
                                     NED
    31 6304 5          1   JOURNAL D UN PARFUMEUR
    9782253163046                    LGF

Trois quantités imprimées, donc exactement trois articles :
1. reference « 19 9119 0 », isbn 9782019462994, title « COLORIAGES MYSTERES TABLEAUX DE MAITRES », publisher « HACHETTE HEROES », quantité 1.
2. reference « 30 1378 6 », isbn 9782253016861, title « LES CHATIMENTS NED », publisher « LGF », quantité 1.
3. reference « 31 6304 5 », isbn 9782253163046, title « JOURNAL D UN PARFUMEUR », publisher « LGF », quantité 1.
« NED » n'a pas de quantité : c'est un complément de l'article 2, pas un quatrième article.

Exemple 2, avec des compléments de titre en seconde ligne :

    ARTICLES         QTE   LIBELLE
    15 5974 9          1   LES AVENTURES D ARSENE LUPIN
    9782011559746                LFF B1            H.EDU. F.L.E.
    33 5449 1          2   CHINOIS TEL QU ON LE PARLE 2ED
    9782200640354                                  DUNOD
    84 8606 6          1   DELF B2 100 REUSSITE  2022  LIVRE  ONPRIN
    9782278102549                LIVRE             DIDIER FLE
    89 1565 8          1   DELF SCOLAIRE ET JUNIOR B2 NOUVEAU FORMAT EP
    9782016286425                LE  AUDIO         H.EDU. F.L.E.

Quatre quantités imprimées, donc exactement quatre articles :
1. isbn 9782011559746, title « LES AVENTURES D ARSENE LUPIN LFF B1 », publisher « H.EDU. F.L.E. », quantité 1.
2. isbn 9782200640354, title « CHINOIS TEL QU ON LE PARLE 2ED », publisher « DUNOD », quantité 2.
3. isbn 9782278102549, title « DELF B2 100 REUSSITE 2022 LIVRE ONPRIN LIVRE », publisher « DIDIER FLE », quantité 1.
4. isbn 9782016286425, title « DELF SCOLAIRE ET JUNIOR B2 NOUVEAU FORMAT EP LE AUDIO », publisher « H.EDU. F.L.E. », quantité 1.

« LFF B1 », « LIVRE », « LE AUDIO » sont des compléments de titre : ils n'ont pas de quantité, donc ils n'ouvrent aucun article. Ajoute-les à la fin du titre de l'article du dessus, séparés par une espace. Ne les prends jamais pour un titre à part, et ne les mets jamais dans publisher : l'éditeur est le bloc de texte le plus à DROITE de la cellule.

Ne jamais décaler d'un cran. Dans l'exemple 1, 9782253016861 va avec « LES CHATIMENTS », pas avec « COLORIAGES MYSTERES » ni avec « JOURNAL D UN PARFUMEUR ».

CONTRÔLE AVANT DE RÉPONDRE
Compte les quantités imprimées dans la colonne QTE, puis compte tes articles : les deux nombres doivent être égaux. Compte ensuite tes ISBN : encore le même nombre.
Si tu as plus d'articles que de quantités, tu as pris un complément pour un titre. Si un article se retrouve sans ISBN pendant qu'un autre en a deux, tu as décalé un bloc. Dans les deux cas, reprends l'appariement depuis le haut du tableau.

REPÉRAGE DES COLONNES
Ces bordereaux varient fortement d'un distributeur à l'autre : l'ordre des colonnes, leurs intitulés et la mise en page changent. Repère chaque colonne par son sens, jamais par sa position.

- \`reference\` : la référence interne du distributeur, sur la ligne du titre. Elle est plus courte que l'ISBN et souvent espacée (« 20 3087 8 », « 45 0505 0 », « 86 1177 2 »). Recopie-la dans ce champ, espaces compris. Chaîne vide si le bordereau n'en imprime pas.
- \`isbn\` : le code à 13 chiffres commençant par 978 ou 979. Il n'est JAMAIS la référence interne : celle-ci ne va pas dans ce champ.
- \`title\` : colonne « Libellé », « LIBELLE », « Désignation » ou « Titre ». Le titre de la ligne portant la quantité, suivi des compléments des lignes sans quantité qui viennent juste après.
- \`publisher\` : le bloc de texte le plus à droite de la cellule de libellé, en seconde ligne. Il porte presque toujours l'éditeur ou la collection (FOLIO, GALLIMARD JEUNE, DUNOD, DIDIER FLE, HERMANN REF., NOUV.MONDE ED., H.EDU. F.L.E., HACHETTE HEROES…). C'est cela qu'il faut renvoyer. Ce n'est PAS un auteur, et il ne faut jamais deviner un auteur. Ce n'est pas non plus le complément de titre, qui est plus à gauche. Chaîne vide si rien n'est imprimé.
- \`quantity_delivered\` : colonne « Qté », « QTE », « Quantité », « Servi » ou « Livré ». C'est le nombre d'exemplaires censés être physiquement dans le carton. Elle est imprimée sur la ligne du titre : ne la lis pas sur la ligne de l'ISBN, où cette colonne est toujours vide.
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
