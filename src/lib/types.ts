export type LineField =
  | "isbn"
  | "title"
  | "publisher"
  | "quantityOrdered"
  | "quantityDelivered";

export const FIELD_LABELS: Record<LineField, string> = {
  isbn: "ISBN",
  title: "Titre",
  publisher: "Éditeur",
  quantityOrdered: "Qté commandée",
  quantityDelivered: "Qté livrée",
};

/** Raison pour laquelle une ligne mérite d'être signalée. */
export type IssueKind =
  /** La clé de contrôle de l'ISBN est fausse : au moins un chiffre est mal lu. */
  | "invalidChecksum"
  /** Le même ISBN apparaissait plusieurs fois, les quantités ont été fusionnées. */
  | "merged"
  /** Champ vide alors qu'il est obligatoire. */
  | "missing"
  /**
   * Un même ISBN se retrouve sur deux titres sans rapport : le signe que le
   * code a été rattaché au libellé du bloc voisin.
   */
  | "alignment"
  /** Le même titre est porté par deux ISBN différents. */
  | "duplicateTitle";

export const ISSUE_LABELS: Record<IssueKind, string> = {
  invalidChecksum: "Clé ISBN invalide",
  merged: "Doublon fusionné",
  missing: "Champ vide",
  alignment: "ISBN sur 2 titres",
  duplicateTitle: "Titre sur 2 ISBN",
};

/**
 * Un signalement bloque le passage au scan, ou reste purement indicatif.
 *
 * Seules les colonnes qui décident du comptage — l'ISBN, qui identifie le livre
 * au scan, et les quantités, qui disent combien doivent sortir du carton —
 * arrêtent l'opérateur. Un titre ou un éditeur douteux s'affichent et se
 * corrigent, mais ne valent pas la peine d'interrompre une réception : ils ne
 * changent rien à ce qu'il y a à compter.
 *
 * L'exception tient au lien entre colonnes plutôt qu'à l'orthographe : un ISBN
 * posé sur deux titres sans rapport ferait compter un livre sur la ligne d'un
 * autre — une erreur qu'aucun scan ne rattrape ensuite.
 */
export type IssueSeverity = "blocking" | "info";

export interface FieldIssue {
  id: string;
  field: LineField;
  kind: IssueKind;
  severity: IssueSeverity;
  /** Valeur lue, en cause dans le signalement. */
  candidateA: string;
  /** Ce à quoi elle s'oppose : l'autre titre, la liste des ISBN, un motif. */
  candidateB: string;
}

/** Une ligne du bon de commande papier, enrichie du comptage physique. */
export interface OrderLine {
  id: string;
  /**
   * Référence interne du distributeur, imprimée sur la ligne du titre (« 19 9119
   * 0 »). Elle n'identifie pas le livre — deux distributeurs numérotent
   * différemment — mais elle est le seul repère qui reste sur le papier quand
   * l'ISBN est mal lu : elle sert à retrouver la ligne sur le bordereau.
   */
  reference: string;
  isbn: string;
  title: string;
  publisher: string;
  quantityOrdered: number;
  quantityDelivered: number;
  pageIndex: number;
  issues: FieldIssue[];
  counted: number;
  damaged: number;
}

/** Un livre trouvé dans le carton mais absent du bon de commande. */
export interface ExtraItem {
  id: string;
  isbn: string;
  counted: number;
  damaged: number;
}

/**
 * Article annoncé comme NON livré par le fournisseur, lu dans une section
 * distincte du bordereau (« NON-SERVI DE VOTRE LIVRAISON », « MANQUANT »,
 * « Reliquat »).
 *
 * Ces articles ne sont pas dans le carton : ils ne doivent jamais être scannés
 * ni comptés comme manquants. Ils figurent au récapitulatif pour mémoire.
 */
export interface NotDeliveredItem {
  id: string;
  isbn: string;
  title: string;
  publisher: string;
  quantity: number;
  reason: string;
}

/**
 * Une ligne de commande client trouvée dans le référentiel, pour un ISBN.
 *
 * C'est une lecture, jamais une écriture : le référentiel est alimenté par
 * l'export de commandes, l'application ne fait que le consulter.
 */
export interface OrderMatch {
  orderReference: string;
  /** Souvent vide : l'export de commandes ne porte pas toujours le client. */
  customer: string;
  title: string;
  author: string;
  publisher: string;
  /** Réponse du fournisseur : « Disponible », « 21 - Epuisé »… */
  supplierResponse: string;
  /** Date d'expédition annoncée, au format ISO. Vide si la ligne est en attente. */
  shippingDate: string;
  /**
   * Ligne déjà réglée : le livre est déjà là, ou le fournisseur ne le servira
   * pas. Il n'y a rien à pointer dessus — mais le savoir vaut mieux que de
   * l'ignorer, donc la ligne s'affiche quand même.
   */
  reserved: boolean;
  unitPrice: number | null;
  /** Remise fournisseur en points de pourcentage (13 pour 13 %). */
  discountPercent: number | null;
  currency: string;
  quantityOrdered: number;
  quantityDelivered: number;
  /** Ce qu'il reste à pointer sur cette commande, d'après le référentiel. */
  quantityRemaining: number;
}

/**
 * Destination des livres absents du référentiel de commandes.
 *
 * Un ISBN introuvable n'est pas une anomalie : c'est une autre catégorie de
 * produits, servie par les commandes journalières. Le libellé tient lieu de
 * référence pour que ces exemplaires se regroupent au récapitulatif comme
 * n'importe quelle commande, au lieu de disparaître dans un total « non
 * affecté » qui ne dit rien.
 */
export const DAILY_ORDERS = "Commandes journalières";

/**
 * Un exemplaire physique du carton, affecté à une commande.
 *
 * L'affectation est décidée par l'opérateur au moment du scan et vit dans la
 * session, pas dans la base : un carton en cours n'a pas à laisser de trace
 * dans le référentiel tant qu'il n'est pas clôturé, et la reprise après
 * fermeture de l'onglet doit retrouver l'état exact du comptage.
 */
export interface Allocation {
  id: string;
  isbn: string;
  orderReference: string;
  customer: string;
  quantity: number;
  /** Remise fournisseur reprise du référentiel, pour l'export de réception. */
  discountPercent: number | null;
  /** Prix d'achat HT repris du référentiel, pour l'export de réception. */
  unitPrice: number | null;
}

/** L'unité de travail : un carton, son bon de commande et son comptage. */
export interface CartonSession {
  id: string;
  startedAt: string;
  supplier: string;
  reference: string;
  pageCount: number;
  lines: OrderLine[];
  extras: ExtraItem[];
  notDelivered: NotDeliveredItem[];
  /** Répartition des exemplaires comptés entre les commandes clients. */
  allocations: Allocation[];
  /**
   * Totaux imprimés sur le bordereau, relevés à titre de référence.
   *
   * Ils ont servi un temps à contrôler la somme des lignes lues. Ce contrôle a
   * été retiré : le récapitulatif de livraison couvre l'expédition entière, et
   * elle porte souvent plusieurs colis (« Nbre colis : 2 »). Le carton en main
   * n'en est qu'un — la somme de ses lignes est donc légitimement inférieure au
   * total imprimé, et l'écart se déclenchait sur des lectures parfaitement
   * justes. Une alarme qui se trompe souvent apprend à ignorer toutes les
   * alarmes, y compris la clé ISBN, qui elle est fiable.
   *
   * Le découpage d'un article sur deux lignes, que l'écart de références
   * servait aussi à détecter, est couvert par les signalements `alignment` et
   * `duplicateTitle` — qui ne dépendent d'aucun total imprimé.
   */
  declaredTotalQuantity: number;
  declaredTotalArticles: number;
}

/** Ligne brute renvoyée par le moteur d'extraction, avant contrôle. */
export interface ExtractedLine {
  reference: string;
  isbn: string;
  title: string;
  publisher: string;
  quantityOrdered: number;
  quantityDelivered: number;
}

export interface ExtractedNotDelivered {
  isbn: string;
  title: string;
  publisher: string;
  quantity: number;
  reason: string;
}

export interface ExtractedPage {
  supplier: string;
  reference: string;
  lines: ExtractedLine[];
  notDelivered: ExtractedNotDelivered[];
  declaredTotalQuantity: number;
  declaredTotalArticles: number;
}

/** Réponse de la route serveur pour une page. */
export interface OcrPageResponse {
  page: ExtractedPage;
}

export function emptySession(): CartonSession {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    supplier: "",
    reference: "",
    pageCount: 0,
    lines: [],
    extras: [],
    notDelivered: [],
    allocations: [],
    declaredTotalQuantity: 0,
    declaredTotalArticles: 0,
  };
}
