import { emptySession } from "./types";
import type {
  CartonSession,
  ExtractedLine,
  ExtractedNotDelivered,
  ExtractedPage,
  OrderLine,
} from "./types";

/**
 * Normalisation de tout ce qui franchit une frontière : la réponse du serveur
 * et l'état relu depuis IndexedDB.
 *
 * Un cast TypeScript sur un `await response.json()` ne vérifie rien à
 * l'exécution : il affirme une forme sans la contrôler. Un onglet resté ouvert
 * sur une version précédente de l'app, face à un serveur déjà redéployé, reçoit
 * alors une charge utile qu'il croit connaître — et casse sur le premier champ
 * absent, après avoir consommé les appels OCR. D'où ces conversions explicites,
 * avec valeur par défaut pour chaque champ.
 */

export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return "";
}

export function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(Math.trunc(value), 0);
  if (typeof value === "string") {
    const digits = value.replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }
  return 0;
}

function toExtractedLine(raw: unknown): ExtractedLine {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    isbn: asText(record.isbn),
    title: asText(record.title),
    // `author` était le nom de ce champ avant qu'on constate que les bordereaux
    // impriment un éditeur, jamais un auteur. On l'accepte encore pour qu'un
    // client et un serveur de versions différentes restent compatibles.
    publisher: asText(record.publisher ?? record.author),
    quantityOrdered: asCount(record.quantityOrdered),
    quantityDelivered: asCount(record.quantityDelivered),
  };
}

function toExtractedNotDelivered(raw: unknown): ExtractedNotDelivered {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    isbn: asText(record.isbn),
    title: asText(record.title),
    publisher: asText(record.publisher),
    quantity: asCount(record.quantity),
    reason: asText(record.reason),
  };
}

export function toExtractedPage(raw: unknown): ExtractedPage {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    supplier: asText(record.supplier),
    reference: asText(record.reference),
    lines: (Array.isArray(record.lines) ? record.lines : []).map(toExtractedLine),
    notDelivered: (Array.isArray(record.notDelivered) ? record.notDelivered : []).map(
      toExtractedNotDelivered,
    ),
    declaredTotalQuantity: asCount(record.declaredTotalQuantity),
    declaredTotalArticles: asCount(record.declaredTotalArticles),
  };
}

/**
 * Remet une session persistée par une version antérieure à la forme courante.
 *
 * On répare plutôt qu'on ne jette : un carton de deux cents livres à moitié
 * compté ne doit pas disparaître parce que le schéma a bougé entre deux
 * déploiements.
 */
export function migrateSession(raw: unknown): CartonSession {
  const record = (raw ?? {}) as Record<string, unknown>;

  const lines = (Array.isArray(record.lines) ? record.lines : []).map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    return {
      id: asText(line.id) || crypto.randomUUID(),
      isbn: asText(line.isbn),
      title: asText(line.title),
      publisher: asText(line.publisher ?? line.author),
      quantityOrdered: asCount(line.quantityOrdered),
      quantityDelivered: asCount(line.quantityDelivered),
      pageIndex: asCount(line.pageIndex),
      issues: Array.isArray(line.issues) ? (line.issues as OrderLine["issues"]) : [],
      counted: asCount(line.counted),
      damaged: asCount(line.damaged),
    } satisfies OrderLine;
  });

  const base = emptySession();
  return {
    id: asText(record.id) || base.id,
    startedAt: asText(record.startedAt) || base.startedAt,
    supplier: asText(record.supplier),
    reference: asText(record.reference),
    pageCount: asCount(record.pageCount),
    lines,
    extras: Array.isArray(record.extras) ? (record.extras as CartonSession["extras"]) : [],
    notDelivered: Array.isArray(record.notDelivered)
      ? (record.notDelivered as CartonSession["notDelivered"])
      : [],
    declaredTotalQuantity: asCount(record.declaredTotalQuantity),
    declaredTotalArticles: asCount(record.declaredTotalArticles),
  };
}
