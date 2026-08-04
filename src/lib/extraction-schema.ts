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
    isbn: {
      type: "string",
      description:
        "ISBN à 13 chiffres commençant par 978 ou 979, chiffres uniquement. Jamais une référence interne du distributeur.",
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
      description: "Quantité effectivement livrée dans ce carton. Colonne « Qté » / « QTE ».",
    },
  },
  required: ["isbn", "title", "publisher", "quantity_ordered", "quantity_delivered"],
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

REPÉRAGE DES COLONNES
Ces bordereaux varient fortement d'un distributeur à l'autre : l'ordre des colonnes, leurs intitulés et la mise en page changent. Repère chaque colonne par son sens, jamais par sa position.

- \`isbn\` : le code à 13 chiffres commençant par 978 ou 979. Il est souvent imprimé sous un code-barres, ou sur une seconde ligne de la colonne « Article ». Cette colonne contient parfois AUSSI une référence interne du distributeur, plus courte et souvent espacée (« 20 3087 8 », « 45 0505 0 », « 86 1177 2 »). Ce n'est pas un ISBN : ne la recopie jamais dans ce champ.
- \`title\` : colonne « Libellé », « LIBELLE », « Désignation » ou « Titre ». Première ligne de la cellule.
- \`publisher\` : la seconde ligne de la cellule de libellé porte presque toujours l'éditeur ou la collection (FOLIO, GALLIMARD JEUNE, MAPAR, GLENAT, HACHETTE HEROES, LIV.POCHE JEUNE…). C'est cela qu'il faut renvoyer. Ce n'est PAS un auteur, et il ne faut jamais deviner un auteur. Chaîne vide si rien n'est imprimé.
- \`quantity_delivered\` : colonne « Qté », « QTE », « Quantité », « Servi » ou « Livré ». C'est le nombre d'exemplaires censés être physiquement dans le carton.
- \`quantity_ordered\` : uniquement s'il existe une colonne distincte « Commandé » ou « Cdé ». Sinon, recopie la même valeur que quantity_delivered.

ARTICLES NON SERVIS
Certains bordereaux comportent une section séparée, sous un titre du genre « NON-SERVI DE VOTRE LIVRAISON », « NON SERVI », « MANQUANT », « Reliquat » ou « Reste à livrer ». Ces articles ne sont PAS dans le carton.
Ne les place jamais dans \`lines\`. Mets-les dans \`not_delivered\`, avec le motif imprimé s'il y en a un.

TOTAUX
Si le document imprime un total d'exemplaires ou de références (« Qté : 45 », « QUANTITE : 7 », « Nbre article(s) : 36 », « ARTICLES 3 »), recopie ces nombres dans declared_total_quantity et declared_total_articles. Sinon 0.

RÈGLES IMPÉRATIVES
- Une entrée par ligne de livre imprimée, dans l'ordre du document.
- N'invente jamais une valeur. Cellule vide, illisible ou barrée → chaîne vide, ou 0.
- Ne complète pas un ISBN de mémoire : recopie strictement les chiffres visibles.
- \`isbn\` : chiffres uniquement, tirets et espaces retirés.
- Ignore les en-têtes, pieds de page, mentions légales, adresses, lignes de TVA, de sous-total et de port.
- Les annotations manuscrites — cercles, coches, croix, ratures — sont les marques du réceptionnaire. Elles ne modifient jamais les chiffres imprimés : recopie l'imprimé.`;
