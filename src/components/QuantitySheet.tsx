"use client";

import { useState } from "react";

import { formatIsbn } from "@/lib/isbn";
import { play } from "@/lib/feedback";
import { displayPublisher, expected, isComplete } from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { Button, NumberPad, Note, Sheet } from "./ui";
import { IconMinus, IconPlus } from "./icons";

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
  context: "scan" | "correction";
  onConfirm: (counted: number, damaged: number) => void;
  onCancel: () => void;
}) {
  const target = expected(line);

  const [count, setCount] = useState(() =>
    context === "correction" ? line.counted : isComplete(line) ? line.counted + 1 : target,
  );
  const [damaged, setDamaged] = useState(line.damaged);
  const [padOpen, setPadOpen] = useState(false);

  const gap = count - target;
  const colour = gap > 0 ? "text-warning" : gap < 0 ? "text-danger" : "text-success";

  return (
    <Sheet
      open
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
          <Button
            onClick={() => {
              play("success");
              onConfirm(count, damaged);
            }}
          >
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
          <Note tone={gap > 0 ? "warning" : "danger"} aria-live="polite">
            {gap > 0 ? `${gap} en surplus` : `${-gap} manquant${-gap > 1 ? "s" : ""}`}
          </Note>
        ) : null}

        {padOpen ? <NumberPad value={count} onChange={setCount} /> : null}

        <div className="flex items-center justify-between rounded-[10px] border border-border px-4 py-3">
          <span className="text-[14px]">Abîmés</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDamaged((value) => Math.max(value - 1, 0))}
              aria-label="Diminuer le nombre d’exemplaires abîmés"
              className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
            >
              <IconMinus className="h-3.5 w-3.5" />
            </button>
            <span
              className={`w-6 text-center font-mono text-[15px] tabular-nums ${
                damaged > 0 ? "text-warning" : "text-faint"
              }`}
            >
              {damaged}
            </span>
            <button
              type="button"
              onClick={() => setDamaged((value) => Math.min(value + 1, Math.max(count, 1)))}
              aria-label="Augmenter le nombre d’exemplaires abîmés"
              className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>

        {context === "scan" && isComplete(line) ? (
          <Note tone="warning">Titre déjà complet ({line.counted}/{target}).</Note>
        ) : null}
      </div>
    </Sheet>
  );
}
