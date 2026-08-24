"use client";

import { formatIsbn } from "@/lib/isbn";
import type { OrderMatch } from "@/lib/types";
import { Note, Spinner } from "./ui";
import { IconCheck, IconMinus, IconPlus } from "./icons";

/** « 2026-08-21 » → « 21/08 ». L'année n'apprend rien sur un carton du jour. */
function formatDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return parts ? `${parts[3]}/${parts[2]}` : iso;
}

/** Ce que l'opérateur a réparti, commande par commande. */
export type Split = Record<string, number>;

export function splitTotal(split: Split): number {
  return Object.values(split).reduce((sum, value) => sum + value, 0);
}

/**
 * Propose une répartition de départ : au plus ce que chaque commande attend,
 * dans l'ordre où le référentiel les rend — le reste à servir en premier.
 *
 * L'exemplaire tombe donc tout seul sur la bonne commande dans le cas courant,
 * celui d'un titre attendu par un seul client. Quand il y en a plusieurs,
 * c'est une proposition, pas une décision : l'opérateur a le livre en main.
 */
export function proposeSplit(matches: readonly OrderMatch[], counted: number): Split {
  const split: Split = {};
  let left = counted;

  for (const match of matches) {
    if (left <= 0) break;
    const share = Math.min(match.quantityRemaining, left);
    if (share <= 0) continue;
    split[match.orderReference] = share;
    left -= share;
  }

  return split;
}

/**
 * Le bloc « commandes » de l'écran de validation.
 *
 * Il répond à la seule question que l'opérateur ne peut pas trancher seul :
 * ce livre, pour qui ? Le référentiel dit quelles commandes l'attendent et en
 * quelle quantité ; le geste de répartition reste humain, parce qu'un
 * exemplaire mal aiguillé part chez le mauvais client sans que rien ne le
 * signale ensuite.
 */
export function OrderPicker({
  isbn,
  counted,
  matches,
  split,
  loading,
  error,
  onChange,
  onRetry,
}: {
  isbn: string;
  counted: number;
  matches: OrderMatch[];
  split: Split;
  loading: boolean;
  error: string | null;
  onChange: (split: Split) => void;
  onRetry: () => void;
}) {
  const assigned = splitTotal(split);
  const left = counted - assigned;

  if (loading) {
    return (
      <div className="rounded-[10px] border border-border px-4 py-3">
        <p className="flex items-center gap-2.5 text-[13px] text-muted" aria-live="polite">
          <Spinner />
          Recherche de la commande…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Note tone="danger">{error}</Note>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-1 text-[13px] text-muted underline underline-offset-2 hover:text-foreground"
        >
          Réessayer
        </button>
        <p className="px-1 pt-2 text-[12px] text-muted">
          Le comptage n’attend pas le référentiel : vous pouvez valider, le livre sera compté sans
          commande.
        </p>
      </div>
    );
  }

  /*
   * Un ISBN absent du référentiel n'est pas une erreur de lecture : les
   * commandes qui y figurent ne couvrent qu'une partie du catalogue, le reste
   * relève des commandes journalières. Le dire franchement évite que
   * l'opérateur cherche une anomalie qui n'existe pas.
   */
  if (matches.length === 0) {
    return (
      <div className="rounded-[10px] border border-border px-4 py-3">
        <p className="text-[14px] font-medium">Pour commandes journalières</p>
        <p className="mt-1.5 text-[12px] text-muted" translate="no">
          {formatIsbn(isbn)} ne figure dans aucune des commandes du référentiel.
        </p>
      </div>
    );
  }

  const single = matches.length === 1;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <p className="text-[13px] font-medium text-muted">
          {single ? "Commande" : `Commandes · ${matches.length}`}
        </p>
        {/*
          Rien de compté, rien à dire : annoncer « réparti » devant trois
          compteurs à zéro donnerait le sentiment que le travail est fait.
        */}
        {!single && counted > 0 ? (
          <p
            className={`font-mono text-[12px] tabular-nums ${left === 0 ? "text-muted" : "text-danger"}`}
            aria-live="polite"
          >
            {left === 0 ? "réparti" : left > 0 ? `${left} à répartir` : `${-left} en trop`}
          </p>
        ) : null}
      </div>

      <ul className="overflow-hidden rounded-[10px] border border-border">
        {matches.map((match) => {
          const share = split[match.orderReference] ?? 0;
          const served = match.quantityRemaining === 0;

          /*
           * L'export ne porte pas toujours le nom du client. Plutôt qu'un
           * « Client non renseigné » qui n'apprend rien, la référence de
           * commande passe alors en tête : c'est elle que l'opérateur
           * retrouvera sur le bordereau.
           */
          const titre = match.customer || match.orderReference;

          return (
            <li
              key={match.orderReference}
              className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3 last:border-0"
            >
              <span className={`shrink-0 ${share > 0 ? "text-success" : "text-faint"}`}>
                {share > 0 ? <IconCheck /> : <IconMinus className="h-4 w-4" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{titre}</span>
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums">
                  {match.customer ? (
                    <span className="text-muted" translate="no">
                      {match.orderReference}
                    </span>
                  ) : null}
                  <span className={served ? "text-faint" : "text-foreground"}>
                    {match.reserved
                      ? "réservé · rien à pointer"
                      : served
                        ? "rien à pointer"
                        : `${match.quantityRemaining} à pointer`}
                  </span>
                  {match.unitPrice !== null ? (
                    <span className="text-faint">
                      {match.unitPrice.toFixed(2)} {match.currency}
                    </span>
                  ) : null}
                </span>
                {/*
                  La réponse du fournisseur ne s'affiche que lorsqu'elle dit
                  autre chose que « disponible » : un livre annoncé épuisé qui
                  sort pourtant du carton mérite un coup d'œil.
                */}
                {match.supplierResponse && match.supplierResponse !== "Disponible" ? (
                  <span className="mt-0.5 block truncate text-[11px] text-danger">
                    {match.supplierResponse}
                  </span>
                ) : null}
                {match.publisher || match.shippingDate ? (
                  <span className="mt-0.5 block truncate text-[11px] text-faint">
                    {[match.publisher, match.shippingDate ? `expédié le ${formatDate(match.shippingDate)}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>

              {/*
                Un seul candidat : rien à choisir, tout ce qui est compté lui
                revient. Afficher des boutons demanderait un geste pour ne rien
                décider, sur le cas le plus fréquent.
              */}
              {single ? (
                <span className="shrink-0 font-mono text-[15px] font-medium tabular-nums">
                  ×{share}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...split, [match.orderReference]: Math.max(share - 1, 0) })
                    }
                    disabled={share === 0}
                    aria-label={`Retirer un exemplaire de la commande ${match.orderReference}`}
                    className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border disabled:opacity-30 active:bg-subtle"
                  >
                    <IconMinus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-5 text-center font-mono text-[16px] font-medium tabular-nums">
                    {share}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...split, [match.orderReference]: Math.min(share + 1, 999) })
                    }
                    aria-label={`Ajouter un exemplaire à la commande ${match.orderReference}`}
                    className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border active:bg-subtle"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {left > 0 && !single ? (
        <p className="px-1 pt-2 text-[12px] text-muted">
          {left} exemplaire{left > 1 ? "s" : ""} de plus que ce que les commandes attendent : ils
          seront comptés sans être affectés.
        </p>
      ) : null}
    </div>
  );
}
