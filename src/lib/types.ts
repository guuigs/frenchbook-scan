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

/** Raison pour laquelle une ligne doit passer devant les yeux d'un humain. */
export type IssueKind =
  /** Les deux moteurs OCR ne lisent pas la même chose. */
  | "conflict"
  /** Un seul des deux moteurs a vu cette ligne. */
  | "singleSource"
  /** La clé de contrôle de l'ISBN est fausse : au moins un chiffre est mal lu. */
  | "invalidChecksum"
  /** Le même ISBN apparaissait plusieurs fois, les quantités ont été fusionnées. */
  | "merged"
  /** Champ vide alors qu'il est obligatoire. */
  | "missing";

export const ISSUE_LABELS: Record<IssueKind, string> = {
  conflict: "Lecture divergente",
  singleSource: "Vu par un seul moteur",
  invalidChecksum: "Clé ISBN invalide",
  merged: "Doublon fusionné",
  missing: "Champ vide",
};

export interface FieldIssue {
  id: string;
  field: LineField;
  kind: IssueKind;
  /** Valeur proposée par le moteur OCR documentaire. */
  candidateA: string;
  /** Valeur proposée par le moteur vision. */
  candidateB: string;
}

/** Une ligne du bon de commande papier, enrichie du comptage physique. */
export interface OrderLine {
  id: string;
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
  /**
   * Totaux imprimés sur le bordereau, quand il en porte. Servent de contrôle de
   * cohérence : c'est le seul moyen de détecter une ligne entière sautée par
   * les deux moteurs à la fois.
   */
  declaredTotalQuantity: number;
  declaredTotalArticles: number;
}

/** Ligne brute renvoyée par un moteur d'extraction, avant rapprochement. */
export interface ExtractedLine {
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
  engineA: ExtractedPage;
  engineB: ExtractedPage | null;
  /** Vrai si un seul moteur a répondu : la vérification croisée est perdue. */
  degraded: boolean;
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
    declaredTotalQuantity: 0,
    declaredTotalArticles: 0,
  };
}
