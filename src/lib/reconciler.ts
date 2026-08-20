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
 * Transforme la lecture OCR d'un bon en lignes de travail, et contrôle ce qui
 * peut l'être sans avoir le papier sous les yeux.
 *
 * La lecture vient d'un seul moteur — l'endpoint OCR documentaire de Mistral.
 * Il n'y a donc plus de second avis à confronter : les contrôles qui restent
 * sont ceux qui se démontrent, et eux seuls arrêtent l'opérateur.
 *
 * 1. La clé de contrôle EAN-13. Un ISBN dont la clé ne tombe pas juste porte au
 *    moins un chiffre faux : c'est une certitude arithmétique, pas une opinion.
 *
 * 2. La cohérence entre colonnes, une fois les pages réunies. Un même ISBN sur
 *    deux titres sans rapport, un titre sur deux ISBN : rien dans la lecture
 *    d'une ligne prise isolément ne peut le révéler, et le premier cas ferait
 *    compter un livre sur la ligne d'un autre.
 */

/**
 * En dessous de ce seuil, deux titres ne sont plus la même lecture abîmée du
 * même libellé : ce sont deux livres différents. Sur un ISBN pourtant identique,
 * cela signe un rattachement au mauvais bloc.
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
 * quand elle manque, la lecture ramène une seule quantité et laisse l'autre à
 * zéro. Sans cette normalisation, la ligne partirait avec un attendu nul et le
 * livre serait déclaré en trop dès le premier scan.
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

/** Ce qu'une ligne prise isolément permet de contrôler. */
function checksumIssues(line: OrderLine): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!line.isbn) {
    issues.push(issue("isbn", "missing", "blocking", "", ""));
  } else if (!isValidIsbn(line.isbn)) {
    issues.push(issue("isbn", "invalidChecksum", "blocking", line.isbn, ""));
  }

  /*
   * Un titre absent est signalé en rouge partout où la ligne s'affiche, mais
   * n'arrête pas : il ne fausse ni l'identification au scan, qui passe par
   * l'ISBN, ni le comptage.
   */
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
 * espaces multiples : « Éditions » contre « Editions » désigne le même éditeur,
 * et deux titres ne doivent pas passer pour différents à cause d'une virgule.
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

/**
 * Une page lue, telle qu'elle sort du moteur, en lignes de travail.
 *
 * Aucun jugement ici : ce que l'OCR a lu est repris tel quel. Les seuls
 * signalements posés sont ceux que la ligne porte en elle — une clé de contrôle
 * fausse, un champ obligatoire vide.
 */
export function toOrderLines(page: ExtractedPage, pageIndex: number): OrderLine[] {
  return page.lines.map((extracted) => {
    const line = makeLine(extracted, pageIndex);
    line.issues = checksumIssues(line);
    return line;
  });
}

/**
 * Rassemble les articles annoncés non livrés, toutes pages confondues.
 *
 * Le dédoublonnage est indulgent — ISBN à défaut de titre : une même section
 * « NON-SERVI » répétée en pied de chaque page ne doit pas produire autant de
 * lignes que de photos.
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
 * Réunit les pages d'un même bon en une seule liste, un ISBN par ligne.
 *
 * Un même ISBN vu deux fois n'est pas une commande de deux lots : c'est le même
 * bloc du bordereau lu deux fois — une page photographiée en double, ou la
 * seconde ligne d'un libellé prise pour un article à part. On garde donc **la
 * plus grande** quantité des deux, jamais leur somme : additionner ferait
 * chercher à l'opérateur un exemplaire qui n'existe pas, et le carton finirait
 * en manque imaginaire.
 *
 * La fusion ne demande rien à personne : elle laisse une mention sur la ligne.
 */
export function consolidate(pages: OrderLine[][]): OrderLine[] {
  const result: OrderLine[] = [];

  for (const line of pages.flat()) {
    const key = normalizeIsbn(line.isbn);
    const existing = key ? result.findIndex((other) => normalizeIsbn(other.isbn) === key) : -1;

    if (existing < 0) {
      result.push(line);
      continue;
    }

    const target = result[existing];
    target.quantityOrdered = Math.max(target.quantityOrdered, line.quantityOrdered);
    target.quantityDelivered = Math.max(target.quantityDelivered, line.quantityDelivered);
    target.reference = target.reference || line.reference;
    target.title = target.title || line.title;
    target.publisher = target.publisher || line.publisher;

    /*
     * Un « champ vide » constaté avant la fusion peut ne plus l'être après :
     * la ligne fantôme d'un complément arrive avec une quantité nulle et vient
     * se rabattre ici. Garder son signalement ferait arbitrer un problème qui
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

    /*
     * Deux lignes de même ISBN mais de titres sans rapport, ce n'est plus un
     * doublon : c'est le même code appelé sur deux sujets différents, donc un
     * rattachement faux d'un côté ou de l'autre. La fusion silencieuse ferait
     * disparaître le livre perdant sans que personne ne le sache.
     */
    const titlesDiffer =
      target.title &&
      line.title &&
      similarity(normalizeText(target.title), normalizeText(line.title)) < ALIGNMENT_THRESHOLD;

    target.issues.push(
      titlesDiffer
        ? issue("title", "alignment", "blocking", target.title, line.title)
        : issue(
            "quantityDelivered",
            "merged",
            "info",
            String(target.quantityDelivered),
            "2 lignes pour un même ISBN",
          ),
    );
  }

  return result;
}

/**
 * Contrôles portant sur le bon entier, une fois toutes les pages réunies.
 *
 * Ils ne regardent pas comment un champ a été lu mais comment les colonnes se
 * répondent : chaque ISBN doit avoir son titre, et chaque titre son seul ISBN.
 * Un titre qui se retrouve sur deux ISBN est le plus souvent une série, parfois
 * la trace d'un bloc décalé : il se vérifie, il n'arrête pas. Rien dans la
 * lecture d'une ligne prise isolément ne peut le révéler.
 */
export function auditStructure(lines: OrderLine[]): OrderLine[] {
  const byTitle = new Map<string, OrderLine[]>();

  for (const line of lines) {
    // Égalité stricte des titres normalisés, jamais une similarité : « DRUUNA
    // T01 » et « DRUUNA T02 » se ressemblent à 90 % et sont deux livres.
    const key = normalizeText(line.title);
    if (!key) continue;
    const group = byTitle.get(key);
    if (group) group.push(line);
    else byTitle.set(key, [line]);
  }

  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const isbns = Array.from(
      new Set(group.map((line) => normalizeIsbn(line.isbn)).filter(Boolean)),
    );
    if (isbns.length < 2) continue;

    for (const line of group) {
      line.issues.push(
        issue("title", "duplicateTitle", "info", line.title, isbns.join(" / ")),
      );
    }
  }

  return lines;
}
