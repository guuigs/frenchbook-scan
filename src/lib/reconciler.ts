import type { ExtractedLine, ExtractedPage, FieldIssue, OrderLine } from "./types";
import { isValidIsbn, normalizeIsbn } from "./isbn";

/**
 * Croise les lectures des deux moteurs OCR pour produire des lignes fiables.
 *
 * Principe : ce qui est lu à l'identique par deux moteurs indépendants **et**
 * dont la clé ISBN est valide est considéré comme sûr. Tout le reste devient un
 * point de contrôle affiché à l'opérateur. On ne cherche pas à deviner : on
 * signale.
 */

/** Seuil de similarité des titres pour apparier deux lignes sans ISBN commun. */
const TITLE_MATCH_THRESHOLD = 0.8;

function issue(
  field: FieldIssue["field"],
  kind: FieldIssue["kind"],
  candidateA: string,
  candidateB: string,
): FieldIssue {
  return { id: crypto.randomUUID(), field, kind, candidateA, candidateB };
}

function makeLine(extracted: ExtractedLine, pageIndex: number): OrderLine {
  return {
    id: crypto.randomUUID(),
    isbn: normalizeIsbn(extracted.isbn),
    title: extracted.title.trim(),
    author: extracted.author.trim(),
    quantityOrdered: Math.max(extracted.quantityOrdered, 0),
    quantityDelivered: Math.max(extracted.quantityDelivered, 0),
    pageIndex,
    issues: [],
    counted: 0,
    damaged: 0,
  };
}

/** Contrôles qui ne dépendent pas de la comparaison entre moteurs. */
function checksumIssues(line: OrderLine): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!line.isbn) {
    issues.push(issue("isbn", "missing", "", ""));
  } else if (!isValidIsbn(line.isbn)) {
    issues.push(issue("isbn", "invalidChecksum", line.isbn, ""));
  }

  if (!line.title) {
    issues.push(issue("title", "missing", "", ""));
  }

  if (line.quantityOrdered === 0 && line.quantityDelivered === 0) {
    issues.push(issue("quantityDelivered", "missing", "0", ""));
  }

  return issues;
}

/**
 * Comparaison indulgente sur la casse, les accents, la ponctuation et les
 * espaces multiples : « Éditions » contre « Editions » n'est pas une divergence
 * de lecture qui mérite l'attention de l'opérateur.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Similarité de Levenshtein normalisée entre 0 et 1. */
export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = [...current];
  }

  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function bestMatch(line: ExtractedLine, candidates: ExtractedLine[]): number {
  const isbn = normalizeIsbn(line.isbn);
  if (isbn) {
    const byIsbn = candidates.findIndex((candidate) => normalizeIsbn(candidate.isbn) === isbn);
    if (byIsbn >= 0) return byIsbn;
  }

  let bestIndex = -1;
  let bestScore = TITLE_MATCH_THRESHOLD;
  candidates.forEach((candidate, index) => {
    const score = similarity(normalizeText(line.title), normalizeText(candidate.title));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function merge(a: ExtractedLine, b: ExtractedLine, pageIndex: number): OrderLine {
  const line = makeLine(a, pageIndex);
  const issues: FieldIssue[] = [];

  if (normalizeIsbn(a.isbn) !== normalizeIsbn(b.isbn)) {
    issues.push(issue("isbn", "conflict", a.isbn, b.isbn));
  }
  if (normalizeText(a.title) !== normalizeText(b.title)) {
    issues.push(issue("title", "conflict", a.title, b.title));
  }
  if (normalizeText(a.author) !== normalizeText(b.author)) {
    issues.push(issue("author", "conflict", a.author, b.author));
  }
  if (a.quantityOrdered !== b.quantityOrdered) {
    issues.push(
      issue("quantityOrdered", "conflict", String(a.quantityOrdered), String(b.quantityOrdered)),
    );
  }
  if (a.quantityDelivered !== b.quantityDelivered) {
    issues.push(
      issue(
        "quantityDelivered",
        "conflict",
        String(a.quantityDelivered),
        String(b.quantityDelivered),
      ),
    );
  }

  line.issues = [...issues, ...checksumIssues(line)];
  return line;
}

export function reconcile(
  engineA: ExtractedPage,
  engineB: ExtractedPage | null,
  pageIndex: number,
): OrderLine[] {
  if (!engineB) {
    // Mode simple lecture : tout est marqué « source unique », seule la clé
    // ISBN sert de garde-fou.
    return engineA.lines.map((extracted) => {
      const line = makeLine(extracted, pageIndex);
      line.issues = [
        issue("title", "singleSource", extracted.title, "— lecture unique —"),
        ...checksumIssues(line),
      ];
      return line;
    });
  }

  const remaining = [...engineB.lines];
  const result: OrderLine[] = [];

  for (const lineA of engineA.lines) {
    const matchIndex = bestMatch(lineA, remaining);
    if (matchIndex < 0) {
      const line = makeLine(lineA, pageIndex);
      line.issues = [
        issue("title", "singleSource", lineA.title, "— absente de la 2ᵉ lecture —"),
        ...checksumIssues(line),
      ];
      result.push(line);
      continue;
    }

    const [lineB] = remaining.splice(matchIndex, 1);
    result.push(merge(lineA, lineB, pageIndex));
  }

  // Lignes vues uniquement par le second moteur : le premier en a sauté une.
  for (const lineB of remaining) {
    const line = makeLine(lineB, pageIndex);
    line.issues = [
      issue("title", "singleSource", "— absente de la 1ʳᵉ lecture —", lineB.title),
      ...checksumIssues(line),
    ];
    result.push(line);
  }

  return result;
}

/**
 * Fusionne les pages d'un même bon : additionne les doublons d'ISBN et signale
 * la fusion pour qu'un humain confirme.
 */
export function consolidate(pages: OrderLine[][]): OrderLine[] {
  const result: OrderLine[] = [];

  for (const line of pages.flat()) {
    const key = normalizeIsbn(line.isbn);
    const existing = key ? result.findIndex((other) => normalizeIsbn(other.isbn) === key) : -1;

    if (existing >= 0) {
      result[existing].quantityOrdered += line.quantityOrdered;
      result[existing].quantityDelivered += line.quantityDelivered;
      result[existing].issues = [
        ...result[existing].issues,
        ...line.issues,
        issue(
          "quantityDelivered",
          "merged",
          String(result[existing].quantityDelivered),
          "cumul de 2 lignes",
        ),
      ];
    } else {
      result.push(line);
    }
  }

  return result;
}
