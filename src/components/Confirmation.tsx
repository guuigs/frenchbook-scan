"use client";

import { formatIsbn } from "@/lib/isbn";
import { displayPublisher } from "@/lib/order";
import { useOrderLookup } from "@/lib/useOrderLookup";
import { DAILY_ORDERS, type OrderLine } from "@/lib/types";
import { Spinner } from "./ui";
import { IconCheck } from "./icons";
import { proposeSplit } from "./OrderPicker";
import type { ScanConfirmation } from "./QuantitySheet";

/**
 * Compte rendu d'un livre attendu en un seul exemplaire.
 *
 * Il n'y a rien à saisir dans ce cas : la quantité ne fait aucun doute, et
 * ouvrir une feuille avec un compteur à incrémenter demandait un geste pour
 * confirmer ce qui était déjà écrit. Reste la seule question qui compte — pour
 * quelle commande — à laquelle l'écran répond au lieu de la poser.
 *
 * La réponse vient de la base, donc elle se fait attendre quelques centaines de
 * millisecondes. L'écran s'affiche sans elle et la complète à son arrivée :
 * faire patienter l'opérateur devant un écran noir pour une information qu'il
 * ne fait que lire n'aurait aucun sens.
 */
export function Confirmation({
  line,
  onNext,
  onSplit,
}: {
  line: OrderLine;
  onNext: (confirmation: ScanConfirmation) => void;
  /** Ouvre la feuille complète quand plusieurs commandes se disputent le livre. */
  onSplit: () => void;
}) {
  const { matches, loading, error } = useOrderLookup(line.isbn);

  const ambiguous = matches.length > 1;

  const allocations =
    matches.length === 0
      ? // Une recherche en échec ne vaut pas une absence : mieux vaut un
        // exemplaire non affecté, visible au récapitulatif, qu'un exemplaire
        // rangé d'office dans les commandes journalières sur la foi d'une panne.
        error
        ? []
        : [{ orderReference: DAILY_ORDERS, customer: "", quantity: 1, discountPercent: null }]
      : Object.entries(proposeSplit(matches, 1))
          .filter(([, quantity]) => quantity > 0)
          .map(([orderReference, quantity]) => {
            const match = matches.find((m) => m.orderReference === orderReference);
            return {
              orderReference,
              customer: match?.customer ?? "",
              quantity,
              discountPercent: match?.discountPercent ?? null,
            };
          });

  const destination = matches[0];

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-[#0f7b34] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Livre compté"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
        <IconCheck className="h-12 w-12" />
        <p className="mt-3 font-mono text-[44px] leading-none font-medium tabular-nums">1/1</p>

        <p className="mt-5 line-clamp-2 text-[16px] font-medium">{line.title || "Titre non lu"}</p>
        <p className="mt-1 truncate text-[13px] text-white/85">{displayPublisher(line)}</p>
        <p className="mt-0.5 font-mono text-[12px] text-white/70 tabular-nums" translate="no">
          {formatIsbn(line.isbn)}
        </p>

        {/*
          Le bloc occupe sa place dès l'ouverture, avant même de savoir quoi
          afficher. Le bouton, lui, est ancré en bas de l'écran : il ne bouge
          pas quand la réponse arrive, et l'opérateur peut le viser sans
          attendre.
        */}
        <div
          className="mt-6 w-full rounded-[10px] border border-white/25 bg-white/10 px-4 py-3 text-left"
          aria-live="polite"
        >
          {loading ? (
            <p className="flex items-center gap-2.5 text-[14px] text-white/85">
              <Spinner />
              Recherche de la commande…
            </p>
          ) : error ? (
            <>
              <p className="text-[14px] font-medium">Commande non vérifiée</p>
              <p className="mt-1 text-[12px] text-white/85">{error}</p>
            </>
          ) : matches.length === 0 ? (
            <p className="text-[14px] font-medium">Pour commandes journalières</p>
          ) : (
            <>
              <p className="truncate text-[14px] font-medium">
                {destination.customer || destination.orderReference}
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] text-white/85 tabular-nums">
                {destination.customer ? <span translate="no">{destination.orderReference}</span> : null}
                {destination.reserved ? <span>réservé</span> : null}
                {destination.unitPrice !== null ? (
                  <span>
                    {destination.unitPrice.toFixed(2)} {destination.currency}
                  </span>
                ) : null}
              </p>
              {/*
                Un livre que le fournisseur annonçait épuisé et qui sort pourtant
                du carton : c'est la contradiction qui mérite un coup d'œil.
              */}
              {destination.supplierResponse && destination.supplierResponse !== "Disponible" ? (
                <p className="mt-1 truncate text-[12px] font-medium">
                  {destination.supplierResponse}
                </p>
              ) : null}
              {ambiguous ? (
                <p className="mt-1 text-[12px] text-white/85">
                  {matches.length} commandes attendent ce titre.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="pb-safe px-5">
        <div className="space-y-2 pb-3">
          <button
            type="button"
            onClick={() => onNext({ counted: 1, damaged: line.damaged, allocations })}
            className="min-h-13 w-full rounded-[10px] bg-white px-4 text-[15px] font-medium text-[#0f7b34] active:bg-white/85"
          >
            Suivant
          </button>
          {ambiguous ? (
            <button
              type="button"
              onClick={onSplit}
              className="min-h-11 w-full rounded-[10px] border border-white/40 px-4 text-[14px] font-medium active:bg-white/15"
            >
              Choisir la commande
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
