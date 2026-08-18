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
  /** Les deux moteurs OCR ne lisent pas la même chose. */
  | "conflict"
  /** Un seul des deux moteurs a vu cette ligne. */
  | "singleSource"
  /** La clé de contrôle de l'ISBN est fausse : au moins un chiffre est mal lu. */
  | "invalidChecksum"
  /** Le même ISBN apparaissait plusieurs fois, les quantités ont été fusionnées. */
  | "merged"
  /** Champ vide alors qu'il est obligatoire. */
  | "missing"
  /**
   * Un même ISBN se retrouve sur deux titres sans rapport : le signe qu'un
   * moteur a rattaché le code au libellé du bloc voisin.
   */
  | "alignment"
  /** Le même titre est porté par deux ISBN différents. */
  | "duplicateTitle"
  /** Divergence tranchée sans intervention, la clé de contrôle ayant départagé. */
  | "autoFixed";

export const ISSUE_LABELS: Record<IssueKind, string> = {
  conflict: "Lecture divergente",
  singleSource: "Vu par un seul moteur",
  invalidChecksum: "Clé ISBN invalide",
  merged: "Doublon fusionné",
  missing: "Champ vide",
  alignment: "ISBN sur 2 titres",
  duplicateTitle: "Titre sur 2 ISBN",
  autoFixed: "Corrigé par la clé",
};

/**
 * Un signalement bloque le passage au scan, ou reste purement indicatif.
 *
 * Seules les colonnes qui décident du comptage — l'ISBN, qui identifie le livre
 * au scan, et les quantités, qui disent combien doivent sortir du carton —
 * arrêtent l'opérateur. Un titre ou un éditeur lus différemment par les deux
 * moteurs sont affichés et corrigeables, mais ne valent pas la peine
 * d'interrompre une réception : ils ne changent rien à ce qu'il y a à compter.
 *
 * L'exception tient à l'appariement plutôt qu'à l'orthographe : un titre absent,
 * un titre porté par deux ISBN, un ISBN posé sur deux titres sans rapport ne
 * sont pas des divergences de lecture mais des liens cassés entre les deux
 * colonnes. Ceux-là arrêtent, parce qu'ils feraient compter un livre sur la
 * ligne d'un autre — une erreur qu'aucun scan ne rattrape ensuite.
 */
export type IssueSeverity = "blocking" | "info";

export interface FieldIssue {
  id: string;
  field: LineField;
  kind: IssueKind;
  severity: IssueSeverity;
  /** Valeur proposée par le moteur OCR documentaire. */
  candidateA: string;
  /** Valeur proposée par le moteur vision. */
  candidateB: string;
}

/** Une ligne du bon de commande papier, enrichie du comptage physique. */
export interface OrderLine {
  id: string;
  /**
   * Référence interne du distributeur, imprimée sur la ligne du titre (« 19 9119
   * 0 »). Elle n'identifie pas le livre — deux distributeurs numérotent
   * différemment — mais elle est le seul repère qui reste sur le papier quand
   * l'ISBN est mal lu : elle sert à retrouver la ligne sur le bordereau, et à
   * apparier les deux lectures d'un même bloc.
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
   * Totaux imprimés sur le bordereau, relevés à titre de référence.
   *
   * Ils ont servi un temps à contrôler la somme des lignes lues. Ce contrôle a
   * été retiré : le récapitulatif de livraison couvre l'expédition entière, et
   * elle porte souvent plusieurs colis (« Nbre colis : 2 »). Le carton en main
   * n'en est qu'un — la somme de ses lignes est donc légitimement inférieure au
   * total imprimé, et l'écart se déclenchait sur des lectures parfaitement
   * justes. Une alarme qui se trompe souvent apprend à ignorer toutes les
   * alarmes, y compris la clé ISBN et la divergence entre moteurs, qui elles
   * sont fiables.
   *
   * Le découpage d'un article sur deux lignes, que l'écart de références
   * servait aussi à détecter, est couvert par les signalements `alignment` et
   * `duplicateTitle` — qui ne dépendent d'aucun total imprimé.
   */
  declaredTotalQuantity: number;
  declaredTotalArticles: number;
}

/** Ligne brute renvoyée par un moteur d'extraction, avant rapprochement. */
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
