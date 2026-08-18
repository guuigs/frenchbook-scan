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
 * Ce qui arrête l'opérateur : une lecture douteuse de l'ISBN ou d'une quantité.
 *
 * Le reste — titre ou éditeur lus différemment par les deux moteurs, ligne non
 * recoupée dont la clé ISBN tombe juste — reste affiché sur la ligne, mais ne
 * fait plus partie de la file d'attente. Une file qui contient tout ne se
 * distingue pas d'une file vide : on finit par tout valider sans regarder.
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

/** Lignes dont un ISBN divergent a été tranché par la clé de contrôle. */
export function autoFixedLines(session: CartonSession): OrderLine[] {
  return session.lines.filter((line) =>
    line.issues.some((entry) => entry.kind === "autoFixed"),
  );
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

export function sessionTitle(session: CartonSession): string {
  return (session.supplier ?? "").trim() || "Carton en cours";
}
