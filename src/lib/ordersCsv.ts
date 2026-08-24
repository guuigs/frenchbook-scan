/**
 * Port TypeScript de `scripts/commandes-vers-csv.py`, pour la conversion
 * côté navigateur des exports « special order » du logiciel de gestion.
 *
 * Une commande par fichier, la référence venant du nom : 10852SP.xlsx →
 * 10852SP. La colonne P.O de l'export est vide sur toutes les lignes, elle ne
 * peut donc pas servir.
 */

const ENTETE = [
  "Code",
  "P.O",
  "Titre",
  "Auteur",
  "Editeur",
  "cdé",
  "rsvé",
  "Réponse",
  "Date expédition",
  "Unité TTC",
  "Remise",
  "Remise %",
  "Valeur TTC",
  "Poids (kg)",
] as const;

export const ORDER_COLUMNS = [
  "order_reference",
  "customer",
  "isbn",
  "title",
  "author",
  "publisher",
  "supplier_response",
  "shipping_date",
  "reserved",
  "unit_price",
  "discount_percent",
  "quantity_ordered",
  "quantity_pending",
] as const;

export interface OrderRow {
  orderReference: string;
  customer: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  supplierResponse: string;
  shippingDate: string | null;
  reserved: boolean;
  unitPrice: number | null;
  discountPercent: number | null;
  quantityOrdered: number;
  quantityPending: number;
}

function texte(valeur: unknown): string {
  return valeur === null || valeur === undefined ? "" : String(valeur).trim();
}

function entier(valeur: unknown): number {
  const chiffres = texte(valeur).replace(/[^0-9]/g, "");
  return chiffres ? parseInt(chiffres, 10) : 0;
}

function prix(valeur: unknown): number | null {
  const brut = texte(valeur).replace(/€/g, "").replace(/ /g, "").replace(/ /g, "").replace(/,/g, ".");
  if (!brut) return null;
  const montant = Number(brut);
  if (Number.isNaN(montant)) return null;
  return montant < 0 ? null : Math.round(montant * 100) / 100;
}

function pourcentage(valeur: unknown): number | null {
  const brut = texte(valeur).replace(/%/g, "").replace(/ /g, "").replace(/ /g, "").replace(/,/g, ".");
  if (!brut) return null;
  const taux = Number(brut);
  if (Number.isNaN(taux)) return null;
  return taux < 0 ? null : Math.round(taux * 100) / 100;
}

/** openpyxl rend « 2026-08-21 00:00:00 » ; l'export CSV rendait « 21/08/2026 ». */
function date(valeur: unknown): string | null {
  if (valeur instanceof Date) {
    return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString().slice(0, 10);
  }
  const brut = texte(valeur);
  if (!brut) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(brut)) return brut.slice(0, 10);
  const jour = brut.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return jour ? `${jour[3]}-${jour[2]}-${jour[1]}` : null;
}

export type ClientsMap = Record<string, string>;

/**
 * Lit clients.csv (order_reference,customer) : la seule source du nom du
 * client, qui ne figure dans aucune colonne de l'export.
 */
export function parseClients(csv: string): ClientsMap {
  const lignes = csv
    .split(/\r\n|\r|\n/)
    .filter((ligne) => ligne.length > 0)
    .map((ligne) => ligne.split(","));

  const corps =
    lignes.length > 0 && texte(lignes[0][0]).toLowerCase() === "order_reference" ? lignes.slice(1) : lignes;

  const clients: ClientsMap = {};
  for (const ligne of corps) {
    if (ligne.length < 2) continue;
    clients[texte(ligne[0])] = texte(ligne[1]);
  }
  return clients;
}

export class HeaderMismatchError extends Error {}

/** `sheet_to_json({ header: 1 })` renvoie un tableau de lignes, chacune un tableau de cellules. */
export function parseOrderSheet(rows: unknown[][], fileName: string, clients: ClientsMap): OrderRow[] {
  const reference = fileName.replace(/\.xlsx$/i, "");

  const entete = (rows[0] ?? []).map((v) => texte(v));
  const attendu = ENTETE as readonly string[];
  if (entete.length !== attendu.length || entete.some((v, i) => v !== attendu[i])) {
    throw new HeaderMismatchError(`en-tête inattendu (${entete.join(", ") || "vide"})`);
  }

  const vues = new Set<string>();
  const resultat: OrderRow[] = [];

  for (const brute of rows.slice(1)) {
    const champs: Record<(typeof ENTETE)[number], unknown> = {} as never;
    ENTETE.forEach((nom, index) => {
      champs[nom] = brute?.[index];
    });

    const isbn = texte(champs["Code"]).replace(/[^0-9]/g, "");
    // Les en-têtes répétés par la pagination et les lignes vides tombent ici.
    if (isbn.length !== 13) continue;
    // La contrainte d'unicité (référence, isbn) rejetterait un doublon
    // interne : on garde la première occurrence plutôt que de faire échouer
    // l'import entier.
    if (vues.has(isbn)) continue;
    vues.add(isbn);

    const quantiteCommandee = entier(champs["cdé"]);
    const reserve = texte(champs["rsvé"]) === "1";

    resultat.push({
      orderReference: reference,
      customer: clients[reference] ?? "",
      isbn,
      title: texte(champs["Titre"]),
      author: texte(champs["Auteur"]),
      publisher: texte(champs["Editeur"]),
      supplierResponse: texte(champs["Réponse"]),
      shippingDate: date(champs["Date expédition"]),
      reserved: reserve,
      unitPrice: prix(champs["Unité TTC"]),
      discountPercent: pourcentage(champs["Remise %"]),
      quantityOrdered: quantiteCommandee,
      // Rien à pointer sur une ligne réservée : le reste est explicitement
      // nul, et c'est cette valeur que la base retient pour le calcul.
      quantityPending: reserve ? 0 : quantiteCommandee,
    });
  }

  return resultat;
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC4180 minimal, `\r\n`, en-tête présent : lu par un humain via l'import CSV de Supabase. */
export function buildOrdersCsv(rows: OrderRow[]): string {
  const lignes = [ORDER_COLUMNS.join(",")];
  for (const row of rows) {
    lignes.push(
      [
        row.orderReference,
        row.customer,
        row.isbn,
        row.title,
        row.author,
        row.publisher,
        row.supplierResponse,
        row.shippingDate ?? "",
        row.reserved ? "true" : "false",
        row.unitPrice !== null ? row.unitPrice.toFixed(2) : "",
        row.discountPercent !== null ? row.discountPercent.toFixed(2) : "",
        String(row.quantityOrdered),
        String(row.quantityPending),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return lignes.join("\r\n") + "\r\n";
}
