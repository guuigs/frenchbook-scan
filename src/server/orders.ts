import "server-only";

import type { OrderMatch } from "@/lib/types";

/**
 * Lecture du référentiel de commandes, dans Supabase.
 *
 * Ce module ne tourne que côté serveur, et c'est structurel : la clé qu'il
 * porte donne accès à la base, et le navigateur n'a jamais à la connaître. Il
 * n'existe d'ailleurs aucun client Supabase dans le paquet envoyé au
 * téléphone — l'application parle à `/api/orders`, qui parle à Supabase.
 *
 * Le seul appel possible est la fonction `lookup_order_lines`, à qui l'on
 * passe un ISBN. Les tables, elles, vivent dans un schéma que l'API REST ne
 * publie pas : même cette clé ne permet pas de les lire directement, ni d'y
 * écrire quoi que ce soit.
 *
 * Pas de dépendance ajoutée non plus : PostgREST est du HTTP, `fetch` suffit,
 * et `@supabase/supabase-js` n'apporterait ici qu'un mégaoctet de code mort.
 */

export class OrdersError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OrdersError";
  }
}

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key) {
    throw new OrdersError(
      "Le référentiel de commandes n’est pas configuré sur le serveur.",
      501,
    );
  }

  return { url: url.replace(/\/+$/, ""), key };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

function asPrice(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/*
 * La réponse est renormalisée ici plutôt que castée : une colonne renommée en
 * base, un import qui laisse un champ vide, et un cast TypeScript ne verrait
 * rien passer — l'écran de scan tomberait au milieu d'un carton.
 */
function toMatch(raw: unknown): OrderMatch {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    orderReference: asText(record.order_reference),
    customer: asText(record.customer),
    title: asText(record.title),
    author: asText(record.author),
    publisher: asText(record.publisher),
    supplierResponse: asText(record.supplier_response),
    shippingDate: asText(record.shipping_date).slice(0, 10),
    reserved: record.reserved === true,
    unitPrice: asPrice(record.unit_price),
    currency: asText(record.currency) || "EUR",
    quantityOrdered: asCount(record.quantity_ordered),
    quantityDelivered: asCount(record.quantity_delivered),
    quantityRemaining: asCount(record.quantity_remaining),
  };
}

export async function lookupOrders(isbn: string): Promise<OrderMatch[]> {
  const { url, key } = config();

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/lookup_order_lines`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Une recherche par livre scanné : la mettre en cache côté serveur
        // ferait travailler l'opérateur sur un référentiel périmé.
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ p_isbn: isbn }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new OrdersError("Le référentiel n’a pas répondu à temps.", 504);
    }
    throw new OrdersError("Référentiel injoignable.", 502);
  }

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new OrdersError("Clé Supabase refusée. Vérifiez SUPABASE_SECRET_KEY.", 502);
    }
    if (response.status === 404) {
      throw new OrdersError(
        "Fonction lookup_order_lines absente : le schéma SQL n’a pas été exécuté.",
        502,
      );
    }
    throw new OrdersError(`Référentiel en erreur (${response.status}) : ${detail.slice(0, 160)}`, 502);
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return Array.isArray(payload) ? payload.map(toMatch).filter((match) => match.orderReference) : [];
}

// MARK: - Dépôt d'une commande

/**
 * Appel générique d'une fonction du schéma `public`.
 *
 * `lookupOrders` garde son propre appel : ses messages d'erreur parlent de
 * l'écran de scan, où l'opérateur a un livre en main et rien à corriger. Ceux
 * de l'import parlent d'un fichier, et n'ont pas les mêmes suites.
 */
async function appeler(fonction: string, corps: unknown): Promise<unknown> {
  const { url, key } = config();

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${fonction}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(corps),
      // Un import de plusieurs milliers de lignes est une seule insertion, mais
      // elle voyage : on laisse plus de marge qu'à une recherche par ISBN.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new OrdersError("Le référentiel n’a pas répondu à temps.", 504);
    }
    throw new OrdersError("Référentiel injoignable.", 502);
  }

  const brut = await response.text();

  if (!response.ok) {
    // 23505 : la commande existe déjà. C'est un refus attendu, pas une panne —
    // la base le tranche elle-même, parce qu'elle est la seule à pouvoir le
    // faire sans se faire doubler par un second import simultané.
    if (brut.includes("23505") || brut.includes("existe déjà")) {
      throw new OrdersError("Cette référence de commande existe déjà.", 409);
    }
    if (response.status === 401 || response.status === 403) {
      throw new OrdersError("Clé Supabase refusée. Vérifiez SUPABASE_SECRET_KEY.", 502);
    }
    if (response.status === 404) {
      throw new OrdersError(
        `Fonction ${fonction} absente : le schéma SQL n’a pas été rejoué.`,
        502,
      );
    }
    throw new OrdersError(`Référentiel en erreur (${response.status}) : ${brut.slice(0, 160)}`, 502);
  }

  try {
    return JSON.parse(brut) as unknown;
  } catch {
    throw new OrdersError("Réponse illisible du référentiel.", 502);
  }
}

/** Combien de lignes portent déjà cette référence. */
export async function countOrderLines(reference: string): Promise<number> {
  const rendu = await appeler("count_order_lines", { p_reference: reference });
  return typeof rendu === "number" && Number.isFinite(rendu) ? rendu : 0;
}

/** Dépose une commande. Rend le nombre de lignes réellement insérées. */
export async function importOrderLines(
  reference: string,
  customer: string,
  rows: readonly unknown[],
): Promise<number> {
  const rendu = await appeler("import_order_lines", {
    p_reference: reference,
    p_customer: customer,
    p_rows: rows,
  });
  return typeof rendu === "number" && Number.isFinite(rendu) ? rendu : 0;
}
