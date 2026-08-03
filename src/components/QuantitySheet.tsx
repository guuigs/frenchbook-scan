"use client";

import { useState } from "react";

import { formatIsbn } from "@/lib/isbn";
import { play } from "@/lib/feedback";
import { backorder, displayAuthor, expected, isComplete } from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { Button, Card, NumberPad, Sheet } from "./ui";

/**
 * Confirmation de quantité pour un titre attendu en plusieurs exemplaires.
 *
 * La quantité attendue est proposée en grand et validable d'un seul geste :
 * c'est le cas courant. Corriger demande un geste de plus, volontairement, car
 * c'est une décision qui apparaîtra au récapitulatif.
 */
export function QuantitySheet({
  line,
  context,
  onConfirm,
  onCancel,
}: {
  line: OrderLine;
  /** D'où vient l'ouverture : la quantité proposée par défaut en dépend. */
  context: "scan" | "correction";
  onConfirm: (counted: number, damaged: number) => void;
  onCancel: () => void;
}) {
  const target = expected(line);

  const [count, setCount] = useState(() => {
    if (context === "correction") return line.counted;
    // Ligne déjà soldée : un exemplaire de plus vient d'être scanné.
    return isComplete(line) ? line.counted + 1 : target;
  });
  const [damaged, setDamaged] = useState(line.damaged);
  const [padOpen, setPadOpen] = useState(false);

  const tone = count > target ? "warning" : count < target ? "danger" : "success";
  const numberColour =
    count > target ? "text-amber-600" : count < target ? "text-red-600" : "text-emerald-600";

  const confirmLabel =
    context === "correction"
      ? `Enregistrer ${count} exemplaire(s)`
      : count === target && count > 1
        ? `Les ${count} sont là`
        : `Valider ${count} exemplaire(s)`;

  return (
    <Sheet
      open
      title={
        <>
          <h2 className="text-lg leading-tight font-semibold">{line.title}</h2>
          <p className="text-sm text-slate-500">{displayAuthor(line)}</p>
          <p className="mt-0.5 font-mono text-xs text-slate-400">{formatIsbn(line.isbn)}</p>
        </>
      }
      footer={
        <div className="space-y-2 pb-2">
          <Button
            tone={tone}
            onClick={() => {
              play("success");
              onConfirm(count, damaged);
            }}
          >
            {confirmLabel}
          </Button>
          <div className="flex gap-2">
            <Button tone="secondary" onClick={() => setPadOpen((open) => !open)}>
              {padOpen ? "Masquer le pavé" : "Autre quantité"}
            </Button>
            <Button tone="secondary" onClick={onCancel} className="max-w-32">
              Annuler
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-500">Quantité comptée</p>
          <div className="mt-2 flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => setCount((value) => Math.max(value - 1, 0))}
              className="h-14 w-14 rounded-full bg-white text-2xl font-semibold shadow-sm active:bg-slate-100"
            >
              −
            </button>
            <span className={`min-w-24 text-6xl font-bold tabular-nums ${numberColour}`}>
              {count}
            </span>
            <button
              type="button"
              onClick={() => setCount((value) => Math.min(value + 1, 999))}
              className="h-14 w-14 rounded-full bg-white text-2xl font-semibold shadow-sm active:bg-slate-100"
            >
              +
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-500">sur {target} annoncé(s) au bon</p>

          {count < target ? (
            <p className="mt-2 inline-block rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
              {target - count} manquant(s)
            </p>
          ) : count > target ? (
            <p className="mt-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
              {count - target} en surplus
            </p>
          ) : null}
        </div>

        {padOpen ? <NumberPad value={count} onChange={setCount} /> : null}

        <Card>
          <div className="flex items-center justify-between">
            <span className="font-medium">⚠ Exemplaires abîmés</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDamaged((value) => Math.max(value - 1, 0))}
                className="h-10 w-10 rounded-lg bg-slate-100 text-lg font-semibold active:bg-slate-200"
              >
                −
              </button>
              <span
                className={`min-w-6 text-center text-lg font-semibold tabular-nums ${
                  damaged > 0 ? "text-amber-600" : "text-slate-400"
                }`}
              >
                {damaged}
              </span>
              <button
                type="button"
                onClick={() => setDamaged((value) => Math.min(value + 1, Math.max(count, 1)))}
                className="h-10 w-10 rounded-lg bg-slate-100 text-lg font-semibold active:bg-slate-200"
              >
                +
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Comptés dans la quantité reçue, mais signalés au récapitulatif.
          </p>
        </Card>

        {context === "correction" ? (
          <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
            Correction manuelle : {line.counted} exemplaire(s) déjà compté(s) pour ce titre.
          </p>
        ) : isComplete(line) ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Ce titre était déjà complet ({line.counted}/{target}). Toute quantité supplémentaire
            sera signalée en surplus.
          </p>
        ) : backorder(line) > 0 ? (
          <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
            Le bon annonce {line.quantityDelivered} exemplaire(s) livré(s) sur{" "}
            {line.quantityOrdered} commandé(s) : {backorder(line)} en reliquat.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
