import { NextResponse } from "next/server";

import { isAuthorized } from "@/server/auth";
import { OrdersError, countOrderLines, importOrderLines } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Colocalisée avec Supabase, comme la recherche : un import de plusieurs
// milliers de lignes est un seul aller-retour, mais un gros.
export const preferredRegion = "cdg1";

/** Au-delà, c'est que le fichier n'est pas une commande. */
const MAX_LIGNES = 20_000;

/**
 * Dépôt d'une commande dans le référentiel.
 *
 * Le navigateur envoie des lignes déjà mises en forme, mais rien de ce qu'il
 * dit n'est cru sur parole : chaque champ est renormalisé ici avant d'atteindre
 * la base. Le client fait la lecture du fichier — un travail de confort, où
 * l'opérateur voit et corrige — pas la validation, qui n'a de valeur que faite
 * du côté qui écrit.
 */
export async function POST(request: Request) {
  if (!(await isAuthorized().catch(() => false))) {
    return NextResponse.json({ error: "Session expirée. Ressaisissez le code." }, { status: 401 });
  }

  let reference: string;
  let customer: string;
  let brutes: unknown[];
  try {
    const body = (await request.json()) as Record<string, unknown>;
    reference = typeof body.reference === "string" ? body.reference.trim() : "";
    customer = typeof body.customer === "string" ? body.customer.trim() : "";
    if (!Array.isArray(body.rows)) throw new Error("rows manquant");
    brutes = body.rows;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  if (reference.length === 0) {
    return NextResponse.json({ error: "La référence de commande est obligatoire." }, { status: 400 });
  }
  if (brutes.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à importer." }, { status: 400 });
  }
  if (brutes.length > MAX_LIGNES) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (${brutes.length} lignes, maximum ${MAX_LIGNES}).` },
      { status: 413 },
    );
  }

  const rows = brutes.map(normaliser).filter((ligne) => /^[0-9]{13}$/.test(ligne.isbn));
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Aucune ligne ne porte d’ISBN à treize chiffres." },
      { status: 400 },
    );
  }

  try {
    /*
     * Le refus du doublon est demandé deux fois : ici pour pouvoir dire combien
     * de lignes existent déjà — une phrase utile — et dans la fonction SQL, qui
     * est la seule à pouvoir le garantir si deux imports se croisent.
     */
    const existantes = await countOrderLines(reference);
    if (existantes > 0) {
      return NextResponse.json(
        {
          error: `La commande « ${reference} » existe déjà (${existantes} ligne${
            existantes > 1 ? "s" : ""
          }). Renommez la référence, ou supprimez-la d’abord côté Supabase.`,
        },
        { status: 409 },
      );
    }

    const inserted = await importOrderLines(reference, customer, rows);
    return NextResponse.json({ inserted, reference, customer });
  } catch (error) {
    if (error instanceof OrdersError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 502 });
    }
    return NextResponse.json({ error: "Import impossible." }, { status: 502 });
  }
}

// MARK: - Renormalisation

function texte(valeur: unknown, taille: number): string {
  return typeof valeur === "string" ? valeur.trim().slice(0, taille) : "";
}

function entier(valeur: unknown): number {
  const nombre = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(nombre) ? Math.min(Math.max(Math.trunc(nombre), 0), 100_000) : 0;
}

function decimal(valeur: unknown, plafond: number): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const nombre = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(nombre) || nombre < 0 || nombre > plafond) return null;
  return Math.round(nombre * 100) / 100;
}

/** Seule la forme ISO passe : la base refuserait le reste, autant le voir ici. */
function date(valeur: unknown): string | null {
  return typeof valeur === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? valeur : null;
}

function normaliser(brute: unknown) {
  const ligne = (brute ?? {}) as Record<string, unknown>;
  const commande = entier(ligne.quantity_ordered);
  const reserve = ligne.reserved === true;

  return {
    isbn: typeof ligne.isbn === "string" ? ligne.isbn.replace(/[^0-9]/g, "") : "",
    title: texte(ligne.title, 500),
    author: texte(ligne.author, 300),
    publisher: texte(ligne.publisher, 300),
    supplier_response: texte(ligne.supplier_response, 200),
    shipping_date: date(ligne.shipping_date),
    reserved: reserve,
    unit_price: decimal(ligne.unit_price, 100_000),
    discount_rate: decimal(ligne.discount_rate, 100),
    quantity_ordered: commande,
    // Rien à pointer sur une ligne réservée : la règle est recopiée ici plutôt
    // que reprise du client, qui pourrait l'avoir perdue en chemin.
    quantity_pending: reserve ? 0 : commande,
  };
}
