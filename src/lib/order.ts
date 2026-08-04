import type { CartonSession, OrderLine } from "./types";
import { normalizeIsbn } from "./isbn";

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

export function needsReview(line: OrderLine): boolean {
  return line.issues.length > 0;
}

export function displayPublisher(line: OrderLine): string {
  return line.publisher.trim() || "Éditeur inconnu";
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

/** Somme des exemplaires lus sur le bordereau, hors articles non servis. */
export function readTotalQuantity(session: CartonSession): number {
  return session.lines.reduce((sum, line) => sum + line.quantityDelivered, 0);
}

/**
 * Écart entre le total imprimé sur le bordereau et la somme des lignes lues.
 *
 * C'est le seul contrôle capable de détecter une ligne entière sautée par les
 * deux moteurs à la fois — la double lecture ne voit rien quand ils omettent la
 * même chose. Purement indicatif : sur un bordereau multi-échéances ou
 * multi-colis, le total imprimé couvre souvent plus que les pages photographiées.
 */
export function declaredQuantityGap(session: CartonSession): number | null {
  if (session.declaredTotalQuantity <= 0) return null;
  const gap = session.declaredTotalQuantity - readTotalQuantity(session);
  return gap > 0 ? gap : null;
}

export function sessionTitle(session: CartonSession): string {
  return session.supplier.trim() || "Carton en cours";
}
