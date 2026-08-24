"use client";

import { useCallback, useEffect, useState } from "react";

import { lookupOrders } from "./orders";
import type { OrderMatch } from "./types";

export interface OrderLookup {
  matches: OrderMatch[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Recherche des commandes d'un ISBN, partagée par les deux écrans de
 * validation.
 *
 * Elle vit à part parce que les deux en ont besoin et qu'ils ne doivent pas en
 * diverger : le compte rendu d'un livre attendu en un exemplaire et celui d'un
 * livre attendu en plusieurs doivent désigner la même commande, avec les mêmes
 * mots.
 */
export function useOrderLookup(isbn: string): OrderLookup {
  const [matches, setMatches] = useState<OrderMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void lookupOrders(isbn)
      .then((found) => {
        if (active) setMatches(found);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMatches([]);
        setError(cause instanceof Error ? cause.message : "Recherche impossible.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isbn, attempt]);

  return { matches, loading, error, retry };
}
