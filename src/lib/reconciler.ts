import type {
  ExtractedLine,
  ExtractedNotDelivered,
  ExtractedPage,
  FieldIssue,
  IssueSeverity,
  NotDeliveredItem,
  OrderLine,
} from "./types";
import { isValidIsbn, normalizeIsbn } from "./isbn";

/**
 * Croise les lectures des deux moteurs OCR pour produire des lignes fiables.
 *
 * Deux principes, dans cet ordre :
 *
 * 1. Ce que la machine peut trancher seule, elle le tranche. Quand les deux
 *    moteurs lisent deux ISBN différents et qu'un seul porte une clé de
 *    contrôle valide, il n'y a rien à arbitrer : l'autre est faux, point. Faire
 *    valider ça par un humain, c'est lui demander de recalculer une clé de tête.
 *
 * 2. Ce qui reste ne remonte que si ça change le comptage. L'ISBN identifie le
 *    livre au scan, les quantités disent combien doivent sortir du carton :
 *    seules ces colonnes arrêtent l'opérateur. Un titre ou un éditeur lus
 *    différemment sont affichés, corrigeables, et n'interrompent rien.
 */

/** Seuil de similarité des titres pour apparier deux lignes sans ISBN commun. */
const TITLE_MATCH_THRESHOLD = 0.8;

/**
 * En dessous de ce seuil, deux titres ne sont plus la même lecture abîmée du
 * même libellé : ce sont deux livres différents. Sur un ISBN pourtant lu à
 * l'identique par les deux moteurs, cela signe un rattachement au mauvais bloc.
 */
const ALIGNMENT_THRESHOLD = 0.45;

function issue(
  field: FieldIssue["field"],
  kind: FieldIssue["kind"],
  severity: IssueSeverity,
  candidateA: string,
  candidateB: string,
): FieldIssue {
  return { id: crypto.randomUUID(), field, kind, severity, candidateA, candidateB };
}

export function isBlocking(entry: FieldIssue): boolean {
  return entry.severity === "blocking";
}

/**
 * Une colonne « Commandé » distincte n'existe pas sur tous les bordereaux ;
 * quand elle manque, un moteur recopie la quantité livrée et l'autre laisse 0.
 * Sans cette normalisation, chaque ligne d'un tel bon remonterait comme une
 * divergence de quantité — un signalement systématique, donc inutile.
 */
function normalizeQuantities(extracted: ExtractedLine): ExtractedLine {
  const ordered = Math.max(extracted.quantityOrdered, 0);
  const delivered = Math.max(extracted.quantityDelivered, 0);
  return {
    ...extracted,
    quantityOrdered: ordered || delivered,
    quantityDelivered: delivered || ordered,
  };
}

function makeLine(extracted: ExtractedLine, pageIndex: number): OrderLine {
  const quantities = normalizeQuantities(extracted);
  return {
    id: crypto.randomUUID(),
    reference: extracted.reference.trim(),
    isbn: normalizeIsbn(extracted.isbn),
    title: extracted.title.trim(),
    publisher: extracted.publisher.trim(),
    quantityOrdered: quantities.quantityOrdered,
    quantityDelivered: quantities.quantityDelivered,
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
    issues.push(issue("isbn", "missing", "blocking", "", ""));
  } else if (!isValidIsbn(line.isbn)) {
    issues.push(issue("isbn", "invalidChecksum", "blocking", line.isbn, ""));
  }

  // Un titre manquant gêne la lecture de l'écran de scan, mais ne fausse ni
  // l'identification du livre ni le comptage : signalé, pas bloquant.
  if (!line.title) {
    issues.push(issue("title", "missing", "info", "", ""));
  }

  if (line.quantityOrdered === 0 && line.quantityDelivered === 0) {
    issues.push(issue("quantityDelivered", "missing", "blocking", "0", ""));
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

// MARK: - Arbitrage de l'ISBN

interface IsbnVerdict {
  isbn: string;
  issues: FieldIssue[];
}

/**
 * Tranche entre deux lectures d'ISBN.
 *
 * La clé de contrôle EAN-13 rend une erreur de chiffre détectable sans avoir le
 * livre en main : quand une seule des deux lectures la vérifie, l'autre est
 * fausse et il n'y a personne à déranger. On ne remonte à l'opérateur que les
 * cas réellement indécidables — deux codes valides mais différents, ou aucun
 * des deux valide.
 */
export function arbitrateIsbn(rawA: string, rawB: string): IsbnVerdict {
  const a = normalizeIsbn(rawA);
  const b = normalizeIsbn(rawB);

  if (a === b) return { isbn: a, issues: [] };

  const validA = Boolean(a) && isValidIsbn(a);
  const validB = Boolean(b) && isValidIsbn(b);

  // Une seule lecture valide : elle gagne, et on garde une trace informative de
  // ce qui a été écarté pour que l'opérateur puisse la retrouver au besoin.
  if (validA && !validB) {
    return { isbn: a, issues: [issue("isbn", "autoFixed", "info", a, b)] };
  }
  if (validB && !validA) {
    return { isbn: b, issues: [issue("isbn", "autoFixed", "info", a, b)] };
  }

  // Une seule lecture tout court : rien à arbitrer, les contrôles de clé
  // prendront le relais.
  if (!a || !b) {
    return { isbn: a || b, issues: [] };
  }

  // Deux codes valides et différents, ou deux codes faux : indécidable.
  return { isbn: a, issues: [issue("isbn", "conflict", "blocking", a, b)] };
}

// MARK: - Appariement des deux lectures

/** Comparaison des références internes : « 19 9119 0 » et « 1991190 » sont la même. */
export function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hasDistinctReferences(lines: ExtractedLine[]): boolean {
  const references = lines.map((line) => normalizeReference(line.reference)).filter(Boolean);
  return references.length > 0 && new Set(references).size === references.length;
}

interface Pairing {
  a: number;
  b: number;
  /**
   * Clé qui a servi à l'appariement. Quand c'est un code — référence interne ou
   * ISBN — les deux moteurs désignent le même bloc du bordereau, et leurs titres
   * sont alors censés se ressembler.
   */
  anchor: "reference" | "isbn" | "title";
}

/**
 * Apparie les lignes des deux moteurs.
 *
 * Les codes d'abord — référence interne, puis ISBN — parce qu'ils ne dépendent
 * pas d'une lecture de texte. La référence passe en premier : elle est imprimée
 * sur la ligne du titre, donc elle identifie le bloc même quand un moteur s'est
 * trompé d'ISBN, ce qui est précisément le cas qu'on cherche à voir.
 *
 * Les restes sont appariés par titre, mais globalement — du meilleur score au
 * moins bon — et non ligne à ligne dans l'ordre du document : un appariement
 * glouton laissait la première ligne rafler le titre d'une autre et faisait
 * remonter deux fausses lignes « vues par un seul moteur ».
 */
function pairLines(
  linesA: ExtractedLine[],
  linesB: ExtractedLine[],
): { pairs: Pairing[]; onlyA: number[]; onlyB: number[] } {
  const takenA = new Set<number>();
  const takenB = new Set<number>();
  const pairs: Pairing[] = [];

  const pairByCode = (
    anchor: "reference" | "isbn",
    key: (line: ExtractedLine) => string,
  ) => {
    linesA.forEach((lineA, indexA) => {
      if (takenA.has(indexA)) return;
      const value = key(lineA);
      if (!value) return;
      const indexB = linesB.findIndex(
        (lineB, index) => !takenB.has(index) && key(lineB) === value,
      );
      if (indexB < 0) return;
      takenA.add(indexA);
      takenB.add(indexB);
      pairs.push({ a: indexA, b: indexB, anchor });
    });
  };

  /*
   * La référence n'est une ancre que si elle distingue réellement les lignes.
   * Un moteur qui recopie le numéro de bordereau sur chaque article produirait
   * sinon un appariement purement positionnel, qui masquerait le décalage même
   * qu'on cherche à voir.
   */
  if (hasDistinctReferences(linesA) && hasDistinctReferences(linesB)) {
    pairByCode("reference", (line) => normalizeReference(line.reference));
  }
  pairByCode("isbn", (line) => normalizeIsbn(line.isbn));

  const candidates: Array<{ a: number; b: number; score: number }> = [];
  linesA.forEach((lineA, indexA) => {
    if (takenA.has(indexA)) return;
    linesB.forEach((lineB, indexB) => {
      if (takenB.has(indexB)) return;
      const score = similarity(normalizeText(lineA.title), normalizeText(lineB.title));
      if (score > TITLE_MATCH_THRESHOLD) candidates.push({ a: indexA, b: indexB, score });
    });
  });
  candidates.sort((left, right) => right.score - left.score);

  for (const candidate of candidates) {
    if (takenA.has(candidate.a) || takenB.has(candidate.b)) continue;
    takenA.add(candidate.a);
    takenB.add(candidate.b);
    pairs.push({ a: candidate.a, b: candidate.b, anchor: "title" });
  }

  pairs.sort((left, right) => left.a - right.a);

  return {
    pairs,
    onlyA: linesA.map((_, index) => index).filter((index) => !takenA.has(index)),
    onlyB: linesB.map((_, index) => index).filter((index) => !takenB.has(index)),
  };
}

// MARK: - Fusion de deux lectures appariées

function merge(
  a: ExtractedLine,
  b: ExtractedLine,
  anchor: Pairing["anchor"],
  pageIndex: number,
): OrderLine {
  const line = makeLine(a, pageIndex);
  const issues: FieldIssue[] = [];

  const verdict = arbitrateIsbn(a.isbn, b.isbn);
  line.isbn = verdict.isbn;
  issues.push(...verdict.issues);

  line.reference = a.reference.trim() || b.reference.trim();

  const titleScore = similarity(normalizeText(a.title), normalizeText(b.title));

  /*
   * Les deux moteurs désignent le même bloc du bordereau — même référence ou
   * même ISBN — mais lui donnent deux titres qui n'ont rien à voir : ce n'est
   * pas un titre mal lu, c'est un code rattaché au mauvais libellé. Ces
   * bordereaux impriment chaque article sur un bloc de deux lignes, et un
   * moteur qui glisse d'un cran associe l'ISBN au livre du dessus ou du
   * dessous. L'erreur est invisible au scan — le code existe bien dans le bon,
   * le livre est simplement décompté sur la mauvaise ligne — donc elle bloque.
   */
  if (
    anchor !== "title" &&
    a.title.trim() &&
    b.title.trim() &&
    titleScore < ALIGNMENT_THRESHOLD
  ) {
    issues.push(issue("title", "alignment", "blocking", a.title, b.title));
  } else if (normalizeText(a.title) !== normalizeText(b.title)) {
    issues.push(issue("title", "conflict", "info", a.title, b.title));
  }

  if (normalizeText(a.publisher) !== normalizeText(b.publisher)) {
    issues.push(issue("publisher", "conflict", "info", a.publisher, b.publisher));
  }

  const quantitiesA = normalizeQuantities(a);
  const quantitiesB = normalizeQuantities(b);

  if (quantitiesA.quantityOrdered !== quantitiesB.quantityOrdered) {
    issues.push(
      issue(
        "quantityOrdered",
        "conflict",
        "blocking",
        String(quantitiesA.quantityOrdered),
        String(quantitiesB.quantityOrdered),
      ),
    );
  }
  if (quantitiesA.quantityDelivered !== quantitiesB.quantityDelivered) {
    issues.push(
      issue(
        "quantityDelivered",
        "conflict",
        "blocking",
        String(quantitiesA.quantityDelivered),
        String(quantitiesB.quantityDelivered),
      ),
    );
  }

  line.issues = [...issues, ...checksumIssues(line)];
  return line;
}

function singleSourceLine(
  extracted: ExtractedLine,
  seenBy: "A" | "B",
  pageIndex: number,
  degraded: boolean,
): OrderLine {
  const line = makeLine(extracted, pageIndex);
  const note = degraded
    ? "— lecture unique —"
    : seenBy === "A"
      ? "— absente de la 2ᵉ lecture —"
      : "— absente de la 1ʳᵉ lecture —";

  /*
   * Ligne non recoupée : ni l'ISBN ni la quantité n'ont de contradicteur. On la
   * marque sans bloquer — la clé de contrôle reste le vrai garde-fou sur
   * l'ISBN, et bloquer ici ferait rouvrir toutes les lignes d'un bon dès qu'un
   * moteur ne répond pas, ce qui reviendrait à ressaisir le bon à la main.
   */
  line.issues = [
    issue(
      "isbn",
      "singleSource",
      "info",
      seenBy === "A" ? extracted.isbn : note,
      seenBy === "B" ? extracted.isbn : note,
    ),
    ...checksumIssues(line),
  ];
  return line;
}

export function reconcile(
  engineA: ExtractedPage,
  engineB: ExtractedPage | null,
  pageIndex: number,
): OrderLine[] {
  if (!engineB) {
    return engineA.lines.map((extracted) =>
      singleSourceLine(extracted, "A", pageIndex, true),
    );
  }

  const { pairs, onlyA, onlyB } = pairLines(engineA.lines, engineB.lines);
  const result: Array<{ order: number; line: OrderLine }> = [];

  for (const pair of pairs) {
    result.push({
      order: pair.a,
      line: merge(engineA.lines[pair.a], engineB.lines[pair.b], pair.anchor, pageIndex),
    });
  }

  for (const index of onlyA) {
    result.push({ order: index, line: singleSourceLine(engineA.lines[index], "A", pageIndex, false) });
  }

  // Lignes vues uniquement par le second moteur : le premier en a sauté une.
  // Elles sont replacées en fin de page, faute de position connue dans A.
  for (const index of onlyB) {
    result.push({
      order: engineA.lines.length + index,
      line: singleSourceLine(engineB.lines[index], "B", pageIndex, false),
    });
  }

  return result.sort((left, right) => left.order - right.order).map((entry) => entry.line);
}

/**
 * Rassemble les articles annoncés non livrés, vus par l'un ou l'autre moteur.
 *
 * On prend l'union et non l'intersection : rater un « non servi » ferait
 * chercher à l'opérateur un livre absent du carton, alors qu'un doublon
 * n'entraîne qu'une ligne de trop au récapitulatif. Le déséquilibre des
 * conséquences dicte le choix.
 */
export function mergeNotDelivered(entries: ExtractedNotDelivered[]): NotDeliveredItem[] {
  const result: NotDeliveredItem[] = [];

  for (const entry of entries) {
    const isbn = normalizeIsbn(entry.isbn);
    const key = isbn || normalizeText(entry.title);
    if (!key) continue;

    const existing = result.find(
      (item) => (normalizeIsbn(item.isbn) || normalizeText(item.title)) === key,
    );

    if (existing) {
      existing.quantity = Math.max(existing.quantity, entry.quantity);
      existing.title = existing.title || entry.title.trim();
      existing.publisher = existing.publisher || entry.publisher.trim();
      existing.reason = existing.reason || entry.reason.trim();
      continue;
    }

    result.push({
      id: crypto.randomUUID(),
      isbn,
      title: entry.title.trim(),
      publisher: entry.publisher.trim(),
      quantity: Math.max(entry.quantity, 0),
      reason: entry.reason.trim(),
    });
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
      const target = result[existing];
      target.quantityOrdered += line.quantityOrdered;
      target.quantityDelivered += line.quantityDelivered;
      target.reference = target.reference || line.reference;
      target.title = target.title || line.title;
      target.publisher = target.publisher || line.publisher;

      /*
       * Un « champ vide » constaté avant la fusion peut ne plus l'être après :
       * c'est le cas courant quand un moteur a pris la seconde ligne d'un
       * libellé pour un article à part, produisant une ligne à quantité nulle
       * qui vient se rabattre ici. Le garder ferait arbitrer un problème qui
       * n'existe plus.
       */
      target.issues = [...target.issues, ...line.issues].filter(
        (entry) =>
          !(
            entry.kind === "missing" &&
            ((entry.field === "title" && target.title) ||
              ((entry.field === "quantityDelivered" || entry.field === "quantityOrdered") &&
                target.quantityDelivered + target.quantityOrdered > 0))
          ),
      );

      target.issues.push(
        issue(
          "quantityDelivered",
          "merged",
          "blocking",
          String(target.quantityDelivered),
          "cumul de 2 lignes",
        ),
      );
    } else {
      result.push(line);
    }
  }

  return result;
}
