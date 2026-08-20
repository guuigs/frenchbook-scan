import type { CartonSession, FieldIssue, OrderLine } from "./types";
import { normalizeIsbn } from "./isbn";
import { isBlocking } from "./reconciler";

/**
 * Ce qui doit physiquement se trouver dans le carton : la quantité que le
 * fournisseur déclare avoir livrée, pas celle qui a été commandée.
 */
export function expected(line: OrderLine): number {
  return line.quantityDelivered > 0 ? line.quantityDelivered : line.quantityOrdered;
}

export function isComplete(line: OrderLine): boolean {
  return line.counted >= expected(line);
}

export function shortfall(line: OrderLine): number {
  return Math.max(expected(line) - line.counted, 0);
}

export function surplus(line: OrderLine): number {
  return Math.max(line.counted - expected(line), 0);
}

/** Écart entre ce qui a été commandé et ce que le fournisseur annonce livrer. */
export function backorder(line: OrderLine): number {
  return Math.max(line.quantityOrdered - line.quantityDelivered, 0);
}

/**
 * Ce qui arrête l'opérateur : un ISBN qui ne tient pas debout, une quantité
 * absente.
 *
 * Le reste — titre non lu, doublon fusionné, série dont les tomes partagent un
 * libellé — reste affiché sur la ligne, mais ne fait pas partie de la file
 * d'attente. Une file qui contient tout ne se distingue pas d'une file vide :
 * on finit par tout valider sans regarder.
 */
export function needsReview(line: OrderLine): boolean {
  return line.issues.some(isBlocking);
}

/** Signalements portés par une ligne sans qu'elle réclame d'arbitrage. */
export function infoIssues(line: OrderLine): FieldIssue[] {
  return line.issues.filter((entry) => !isBlocking(entry));
}

export function blockingIssues(line: OrderLine): FieldIssue[] {
  return line.issues.filter(isBlocking);
}

/**
 * Tolérant à une ligne relue d'un cache écrit par une version antérieure : un
 * champ absent doit dégrader l'affichage, jamais faire tomber tout l'écran de
 * scan au milieu d'un carton.
 */
export function displayPublisher(line: OrderLine): string {
  return (line.publisher ?? "").trim() || "Éditeur inconnu";
}

export function pendingLines(session: CartonSession): OrderLine[] {
  return session.lines.filter(needsReview);
}

export function isReviewComplete(session: CartonSession): boolean {
  return pendingLines(session).length === 0;
}

export function totalExpected(session: CartonSession): number {
  return session.lines.reduce((sum, line) => sum + expected(line), 0);
}

export function totalCounted(session: CartonSession): number {
  return session.lines.reduce((sum, line) => sum + Math.min(line.counted, expected(line)), 0);
}

export function totalExtras(session: CartonSession): number {
  return session.extras.reduce((sum, extra) => sum + extra.counted, 0);
}

export function totalDamaged(session: CartonSession): number {
  return (
    session.lines.reduce((sum, line) => sum + line.damaged, 0) +
    session.extras.reduce((sum, extra) => sum + extra.damaged, 0)
  );
}

export function progress(session: CartonSession): number {
  const target = totalExpected(session);
  return target > 0 ? totalCounted(session) / target : 0;
}

export function missingLines(session: CartonSession): OrderLine[] {
  return session.lines.filter((line) => shortfall(line) > 0);
}

export function surplusLines(session: CartonSession): OrderLine[] {
  return session.lines.filter((line) => surplus(line) > 0);
}

export function damagedLines(session: CartonSession): OrderLine[] {
  return session.lines.filter((line) => line.damaged > 0);
}

export function backorderedLines(session: CartonSession): OrderLine[] {
  return session.lines.filter((line) => backorder(line) > 0);
}

export function totalMissing(session: CartonSession): number {
  return missingLines(session).reduce((sum, line) => sum + shortfall(line), 0);
}

export function totalSurplus(session: CartonSession): number {
  return surplusLines(session).reduce((sum, line) => sum + surplus(line), 0);
}

export function hasAnomalies(session: CartonSession): boolean {
  return (
    missingLines(session).length > 0 ||
    surplusLines(session).length > 0 ||
    damagedLines(session).length > 0 ||
    session.extras.length > 0
  );
}

export function findLineIndex(session: CartonSession, isbn: string): number {
  const target = normalizeIsbn(isbn);
  return session.lines.findIndex((line) => normalizeIsbn(line.isbn) === target);
}

export function findExtraIndex(session: CartonSession, isbn: string): number {
  const target = normalizeIsbn(isbn);
  return session.extras.findIndex((extra) => normalizeIsbn(extra.isbn) === target);
}

/**
 * Fusionne les lignes qui portent le même ISBN, en n'en gardant qu'une.
 *
 * Un ISBN identifie un livre et un seul : deux lignes qui le partagent sont
 * forcément la même, dédoublée par un découpage d'article raté à la lecture.
 *
 * Sans cette fusion, la seconde ligne devient injoignable au scan — la
 * recherche par ISBN s'arrête à la première — et le carton se clôture sur un
 * manque fantôme qu'aucun code-barres ne peut solder. C'est le cas de figure
 * qui apparaît juste après une correction d'ISBN dans l'écran de contrôle,
 * quand la valeur rectifiée rejoint celle d'une ligne voisine.
 *
 * La quantité retenue est la plus grande, jamais la somme : un article dédoublé
 * porte la même quantité des deux côtés, l'additionner la doublerait.
 */
export function mergeDuplicateIsbns(lines: OrderLine[]): OrderLine[] {
  const result: OrderLine[] = [];

  for (const line of lines) {
    const key = normalizeIsbn(line.isbn);
    const index = key ? result.findIndex((other) => normalizeIsbn(other.isbn) === key) : -1;

    if (index < 0) {
      result.push(line);
      continue;
    }

    const target = result[index];
    result[index] = {
      ...target,
      quantityOrdered: Math.max(target.quantityOrdered, line.quantityOrdered),
      quantityDelivered: Math.max(target.quantityDelivered, line.quantityDelivered),
      title: target.title || line.title,
      publisher: target.publisher || line.publisher,
      reference: target.reference || line.reference,
      // Un comptage déjà fait ne doit pas disparaître dans la fusion.
      counted: Math.max(target.counted, line.counted),
      damaged: Math.max(target.damaged, line.damaged),
      issues: [...target.issues, ...line.issues],
    };
  }

  return result;
}

/**
 * Le signalement « même titre, plusieurs ISBN », tant qu'il n'a pas été vérifié.
 */
export function variantIssue(line: OrderLine): FieldIssue | undefined {
  return line.issues.find((entry) => entry.kind === "duplicateTitle");
}

export interface VariantGroup {
  /** Les ISBN du groupe, dans l'ordre où ils ont été relevés. */
  key: string;
  title: string;
  lines: OrderLine[];
}

/**
 * Les titres portés par plusieurs ISBN, regroupés pour vérification.
 *
 * C'est le cas courant d'une série — trois tomes édités sous le même libellé —
 * ou d'un même livre en deux façonnages. Rien n'y est anormal : il n'y a qu'à
 * confirmer que chaque ISBN est bien celui d'un volume distinct. D'où un bloc à
 * part, qui ne bloque pas le passage au scan, et une validation ISBN par ISBN :
 * les libellés étant souvent identiques au caractère près, seul le code
 * distingue les lignes entre elles.
 */
export function variantGroups(session: CartonSession): VariantGroup[] {
  const groups = new Map<string, VariantGroup>();

  for (const line of session.lines) {
    // Une ligne qui réclame déjà un arbitrage est traitée là-bas : l'écran
    // d'édition remet tout à plat, y compris le signalement de variante.
    if (needsReview(line)) continue;

    const entry = variantIssue(line);
    if (!entry) continue;

    // La clé est la liste d'ISBN portée par le signalement : elle est identique
    // sur toutes les lignes d'un même groupe, et le reste après qu'une ligne a
    // été validée et retirée.
    const group = groups.get(entry.candidateB);
    if (group) group.lines.push(line);
    else groups.set(entry.candidateB, { key: entry.candidateB, title: line.title, lines: [line] });
  }

  return Array.from(groups.values());
}

export function sessionTitle(session: CartonSession): string {
  return (session.supplier ?? "").trim() || "Carton en cours";
}
