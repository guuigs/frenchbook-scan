"use client";

import { useEffect, useState } from "react";

import { formatIsbn } from "@/lib/isbn";
import { play } from "@/lib/feedback";
import { displayPublisher, expected, isComplete } from "@/lib/order";
import { useOrderLookup } from "@/lib/useOrderLookup";
import { DAILY_ORDERS, type OrderLine } from "@/lib/types";
import { Button, NumberPad, Note, Sheet } from "./ui";
import { IconAlert, IconMinus, IconPlus } from "./icons";
import { OrderPicker, proposeSplit, type Split } from "./OrderPicker";

/** Ce que l'écran de validation renvoie : combien, et pour qui. */
export interface ScanConfirmation {
  counted: number;
  damaged: number;
  allocations: Array<{
    orderReference: string;
    customer: string;
    quantity: number;
    discountPercent: number | null;
    unitPrice: number | null;
  }>;
}

/**
 * Validation d'un livre dont la quantité demande un arbitrage.
 *
 * Elle ne s'ouvre plus à chaque scan : un titre attendu en un seul exemplaire
 * n'a pas de quantité à trancher, et se solde du compte rendu de `Confirmation`.
 * Restent les deux cas qui posent une vraie question — plusieurs exemplaires
 * attendus, ou un titre déjà complet qui repasse devant l'objectif.
 *
 * La quantité attendue et la répartition proposée sont pré-remplies : dans le
 * cas courant — un titre, une commande — il ne reste qu'à confirmer.
 */
export function QuantitySheet({
  line,
  context,
  onConfirm,
  onCancel,
}: {
  line: OrderLine;
  context: "scan" | "correction";
  onConfirm: (confirmation: ScanConfirmation) => void;
  onCancel: () => void;
}) {
  const target = expected(line);

  const [count, setCount] = useState(() =>
    context === "correction" ? line.counted : isComplete(line) ? line.counted + 1 : target,
  );
  const [damaged, setDamaged] = useState(line.damaged);
  const [padOpen, setPadOpen] = useState(false);

  const { matches, loading, error: lookupError, retry } = useOrderLookup(line.isbn);
  const [split, setSplit] = useState<Split>({});
  const [touched, setTouched] = useState(false);

  /*
   * La répartition suit la quantité tant que l'opérateur n'y a pas touché :
   * monter le compteur de 1 à 2 doit servir un second exemplaire, pas laisser
   * une ligne à moitié affectée. Dès qu'il a réparti à la main, on ne touche
   * plus à son choix.
   */
  useEffect(() => {
    if (!touched && !loading) setSplit(proposeSplit(matches, count));
  }, [count, matches, touched, loading]);

  const gap = count - target;
  const colour = gap === 0 ? "text-success" : "text-danger";

  const confirm = () => {
    play("success");
    onConfirm({
      counted: count,
      damaged,
      // Titre absent du référentiel : tout part aux commandes journalières,
      // sans rien demander — il n'y a pas de choix à faire.
      allocations:
        matches.length === 0 && !lookupError && count > 0
          ? [
              {
                orderReference: DAILY_ORDERS,
                customer: "",
                quantity: count,
                discountPercent: null,
                unitPrice: null,
              },
            ]
          : matches
              .map((match) => ({
                orderReference: match.orderReference,
                customer: match.customer,
                quantity: split[match.orderReference] ?? 0,
                discountPercent: match.discountPercent,
                unitPrice: match.unitPrice,
              }))
              .filter((entry) => entry.quantity > 0),
    });
  };

  return (
    <Sheet
      open
      onDismiss={onCancel}
      header={
        <>
          <h2 className="truncate text-[15px] font-medium">{line.title}</h2>
          <p className="truncate text-[13px] text-muted">{displayPublisher(line)}</p>
          <p className="mt-0.5 font-mono text-[11px] text-faint tabular-nums" translate="no">
            {formatIsbn(line.isbn)}
          </p>
        </>
      }
      footer={
        <div className="space-y-2 pb-3">
          <Button onClick={confirm}>
            {gap === 0 && count > 1 ? `Les ${count} sont là` : `Valider ${count}`}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPadOpen((open) => !open)}>
              {padOpen ? "Masquer" : "Saisir"}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-6 py-2">
          <button
            type="button"
            onClick={() => setCount((value) => Math.max(value - 1, 0))}
            aria-label="Diminuer la quantité comptée"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
          >
            <IconMinus className="h-5 w-5" />
          </button>

          <p className="text-center">
            <span className={`block font-mono text-[56px] leading-none font-medium tabular-nums ${colour}`}>
              {count}
            </span>
            <span className="mt-1.5 block font-mono text-[12px] text-faint tabular-nums">
              attendu {target}
            </span>
          </p>

          <button
            type="button"
            onClick={() => setCount((value) => Math.min(value + 1, 999))}
            aria-label="Augmenter la quantité comptée"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
          >
            <IconPlus className="h-5 w-5" />
          </button>
        </div>

        {gap !== 0 ? (
          <Note tone="danger" aria-live="polite">
            {gap > 0 ? `${gap} en surplus` : `${-gap} manquant${-gap > 1 ? "s" : ""}`}
          </Note>
        ) : null}

        {padOpen ? <NumberPad value={count} onChange={setCount} /> : null}

        <OrderPicker
          isbn={line.isbn}
          counted={count}
          matches={matches}
          split={split}
          loading={loading}
          error={lookupError}
          onChange={(next) => {
            setTouched(true);
            setSplit(next);
          }}
          onRetry={retry}
        />

        {/*
          Le filet passe au rouge dès qu'un exemplaire est signalé : la ligne
          doit se distinguer au premier coup d'œil, sinon l'opérateur valide
          sans voir qu'il a marqué un abîmé.
        */}
        <div
          className={`rounded-[10px] border px-4 py-3 ${
            damaged > 0 ? "border-danger" : "border-border"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[14px] font-medium">
              <IconAlert className={damaged > 0 ? "text-danger" : "text-faint"} />
              Exemplaires abîmés
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDamaged((value) => Math.max(value - 1, 0))}
                aria-label="Diminuer le nombre d’exemplaires abîmés"
                disabled={damaged === 0}
                className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border disabled:opacity-30 active:bg-subtle"
              >
                <IconMinus className="h-3.5 w-3.5" />
              </button>
              <span
                className={`w-6 text-center font-mono text-[17px] font-medium tabular-nums ${
                  damaged > 0 ? "text-danger" : "text-faint"
                }`}
              >
                {damaged}
              </span>
              <button
                type="button"
                onClick={() => setDamaged((value) => Math.min(value + 1, Math.max(count, 1)))}
                aria-label="Augmenter le nombre d’exemplaires abîmés"
                className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border active:bg-subtle"
              >
                <IconPlus className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Reçus mais endommagés. Comptés dans la quantité, signalés au récapitulatif.
          </p>
        </div>

        {context === "scan" && isComplete(line) ? (
          <Note tone="danger">Titre déjà complet ({line.counted}/{target}).</Note>
        ) : null}
      </div>
    </Sheet>
  );
}
