/**
 * Schéma JSON strict imposé aux deux moteurs d'extraction, pour qu'ils
 * renvoient exactement la même forme et soient comparables champ à champ.
 */
export const EXTRACTION_SCHEMA = {
  type: "object",
  title: "PurchaseOrderPage",
  properties: {
    supplier: {
      type: "string",
      description:
        "Nom du fournisseur / éditeur figurant sur le bon. Chaîne vide si absent.",
    },
    reference: {
      type: "string",
      description: "Numéro ou référence du bon de commande. Chaîne vide si absent.",
    },
    lines: {
      type: "array",
      description: "Une entrée par ligne de livre du tableau, dans l'ordre du document.",
      items: {
        type: "object",
        properties: {
          isbn: {
            type: "string",
            description: "ISBN ou EAN, chiffres uniquement, sans tiret ni espace.",
          },
          title: { type: "string", description: "Titre du livre, tel qu'imprimé." },
          author: {
            type: "string",
            description: "Auteur. Chaîne vide si la colonne n'existe pas.",
          },
          quantity_ordered: {
            type: "integer",
            description: "Quantité commandée. 0 si absent.",
          },
          quantity_delivered: {
            type: "integer",
            description: "Quantité livrée / servie. 0 si absent.",
          },
        },
        required: ["isbn", "title", "author", "quantity_ordered", "quantity_delivered"],
        additionalProperties: false,
      },
    },
  },
  required: ["supplier", "reference", "lines"],
  additionalProperties: false,
} as const;

export const EXTRACTION_INSTRUCTION = `Tu extrais le tableau d'un bon de commande de livres, en français.

Règles impératives :
- Une entrée du tableau \`lines\` par ligne de livre imprimée, dans l'ordre du document.
- N'invente jamais une valeur. Si une cellule est vide, illisible ou barrée, renvoie une chaîne vide (ou 0 pour un nombre).
- Ne complète pas un ISBN de mémoire : recopie strictement les chiffres visibles.
- \`isbn\` : chiffres uniquement, tirets et espaces retirés.
- \`quantity_ordered\` : la colonne « commandé / cdé / qté cde ».
- \`quantity_delivered\` : la colonne « livré / servi / expédié ». Si une seule colonne de quantité existe, mets la même valeur dans les deux.
- Ignore les en-têtes, totaux, pieds de page, mentions légales et lignes de sous-total.
- Les mentions manuscrites (rayures, annotations, « manque », « en attente ») ne changent pas les chiffres imprimés : recopie l'imprimé.`;
