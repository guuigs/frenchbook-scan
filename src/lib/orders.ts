"use client";

import type { OrderMatch } from "./types";

/**
 * Recherche des commandes clients liées à un ISBN.
 *
 * Le navigateur ne connaît ni l'adresse de la base ni la moindre clé : il
 * appelle `/api/orders`, et c'est le serveur qui interroge Supabase.
 */

export class OrdersLookupError extends Error {}

export async function lookupOrders(isbn: string): Promise<OrderMatch[]> {
  let response: Response;
  try {
    response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn }),
    });
  } catch {
    throw new OrdersLookupError("Référentiel injoignable. Vérifiez la connexion.");
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new OrdersLookupError(
      payload && typeof payload.error === "string"
        ? payload.error
        : `Recherche impossible (${response.status}).`,
    );
  }

  return Array.isArray(payload?.matches) ? (payload.matches as OrderMatch[]) : [];
}
