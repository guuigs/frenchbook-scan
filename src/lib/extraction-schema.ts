/**
 * Schéma JSON strict imposé au moteur d'extraction.
 *
 * Il est calé sur des bordereaux réels (SODIS/Gallimard, CDL Hachette), dont
 * la mise en page diffère fortement : ordre des colonnes, intitulés, présence
 * ou non d'une référence interne à côté de l'ISBN. Chaque champ y est décrit
 * par son sens et non par sa position, puisque rien ne garantit la seconde.
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

/**
 * Les règles de découpage, portées par le schéma lui-même.
 *
 * L'endpoint OCR documentaire ne prend pas de consigne libre : il ne reçoit que
 * `document_annotation_format`, c'est-à-dire ce schéma. Sa `description` est
 * donc le seul canal par lequel les règles de structure atteignent le moteur —
 * d'où un texte plus long que ne le voudrait la coutume, exemple travaillé
 * compris. Il n'y a plus de seconde lecture pour rattraper un bloc décalé : ce
 * qui se joue ici se joue une seule fois.
 */
const STRUCTURE_RULES = `Bordereau de livraison de livres, en français.

DÉCOUPAGE — la quantité est l'ancre.
Un article occupe un BLOC de deux lignes imprimées, parfois trois. Ligne 1 : la référence interne, LA QUANTITÉ et le TITRE, alignés horizontalement. Ligne 2 : l'ISBN à 13 chiffres, un éventuel complément de titre, et l'éditeur tout à droite. Cette seconde ligne n'a jamais de quantité.
Un nouvel article commence exactement là où une quantité est imprimée, et nulle part ailleurs. Toute ligne sans quantité est la suite de celle du dessus : son ISBN appartient au titre AU-DESSUS, jamais à celui du dessous, et son complément (« LFF B1 », « NED », « LE AUDIO ») s'ajoute à ce titre au lieu d'ouvrir un article.
Autant d'articles que de quantités imprimées, autant d'ISBN que d'articles.

EXEMPLE — colonne ARTICLES à gauche, QTE au milieu, LIBELLE à droite :

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
« NED » n'a pas de quantité : c'est un complément de l'article 2, pas un quatrième article. Et 9782253016861 va avec « LES CHATIMENTS », jamais avec le titre du dessus ni celui du dessous.

CONTRÔLE AVANT DE RÉPONDRE.
Compte les quantités imprimées dans la colonne QTE, puis compte tes articles : les deux nombres doivent être égaux. Compte ensuite tes ISBN : encore le même nombre. Plus d'articles que de quantités, tu as pris un complément pour un titre. Un article sans ISBN pendant qu'un autre en a deux, tu as décalé un bloc. Dans les deux cas, reprends l'appariement depuis le haut du tableau.

QUANTITÉ MANQUANTE. Jamais implicite : case vide sur la ligne du titre → 0, sans recopier la quantité de l'article précédent.

SECTION FINALE. À partir d'un intertitre « R E P O N S E S », « NON-SERVI », « MANQUANT » ou « Reliquat » et jusqu'au bas du tableau, plus rien n'est dans le carton : ces articles vont dans not_delivered, et la ligne sans quantité y porte le motif (« A PARAITRE ») au lieu d'un complément.

FIDÉLITÉ. Ne complète jamais un ISBN de mémoire et ne corrige jamais sa clé de contrôle : recopie les chiffres visibles. Une lecture fidèle mais fausse est utile — la clé la démasque — alors qu'une lecture « réparée » passe pour juste. Cellule vide ou illisible → chaîne vide, ou 0. Un même ISBN n'apparaît qu'une fois dans lines.`;

export const EXTRACTION_SCHEMA = {
  type: "object",
  title: "DeliveryNotePage",
  description: STRUCTURE_RULES,
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
        "Tous les articles situés APRÈS un intertitre « RÉPONSES », « NON-SERVI », « MANQUANT » ou « Reliquat », jusqu'au bas du tableau : ils ne sont PAS dans le carton, même s'ils portent une quantité.",
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
              "Motif imprimé tel quel, généralement sur la ligne de l'ISBN, là où un article livré porterait un complément de titre (« A PARAITRE », « EPUISE », « MANQUANT PAS NOTE »). Chaîne vide si absent.",
          },
        },
        required: ["isbn", "title", "publisher", "quantity", "reason"],
        additionalProperties: false,
      },
    },
    declared_total_quantity: {
      type: "integer",
      description:
        "Total d'exemplaires du récapitulatif de LIVRAISON (« QUANTITE: 23 », « Qté : 45 »). Jamais celui d'une ligne « TOTAL COMMANDE », qui couvre toute la commande. 0 si absent.",
    },
    declared_total_articles: {
      type: "integer",
      description:
        "Nombre de références du récapitulatif de LIVRAISON (« ARTICLES: 19 », « Nbre article(s) »), hors section « RÉPONSES ». Jamais celui d'une ligne « TOTAL COMMANDE ». 0 si absent.",
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
