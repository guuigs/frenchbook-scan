import { NextResponse } from "next/server";

import { isAuthorized } from "@/server/auth";
import { OrdersError, lookupOrders } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
/**
 * Colocalisée avec Supabase (`eu-west-3`, Paris) plutôt que dans la région
 * par défaut de Vercel : c'est l'aller-retour vers la base, pas la fonction
 * elle-même, qui domine le temps de réponse à chaque scan.
 */
export const preferredRegion = "cdg1";

/**
 * À quelle commande appartient le livre qu'on vient de scanner ?
 *
 * La route ne prend qu'un ISBN et ne rend que des lignes de commande. Elle est
 * derrière le cookie de session comme les autres : sans le code d'accès, on
 * n'interroge pas le référentiel client.
 */
export async function POST(request: Request) {
  if (!(await isAuthorized().catch(() => false))) {
    return NextResponse.json({ error: "Session expirée. Ressaisissez le code." }, { status: 401 });
  }

  let isbn: string;
  try {
    const body = (await request.json()) as { isbn?: unknown };
    if (typeof body.isbn !== "string") throw new Error("isbn manquant");
    isbn = body.isbn.replace(/[^0-9]/g, "");
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  // Treize chiffres, pas autre chose : la forme est vérifiée ici plutôt que
  // laissée filer jusqu'à la base, qui n'a pas à voir passer n'importe quoi.
  if (isbn.length !== 13) {
    return NextResponse.json({ error: "ISBN invalide." }, { status: 400 });
  }

  try {
    return NextResponse.json({ matches: await lookupOrders(isbn) });
  } catch (error) {
    if (error instanceof OrdersError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 502 });
    }
    return NextResponse.json({ error: "Recherche impossible." }, { status: 502 });
  }
}
