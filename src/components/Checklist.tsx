"use client";

import { useMemo, useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import { normalizeText } from "@/lib/reconciler";
import { expected, isComplete, surplus } from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { Button, SectionTitle, Sheet } from "./ui";
import { QuantitySheet } from "./QuantitySheet";

/**
 * Consultation de l'avancement pendant le scan, sans quitter le carton.
 *
 * Deux usages : retrouver un titre précis dans un gros carton, et corriger une
 * ligne déjà comptée — notamment pour signaler un exemplaire abîmé sur un titre
 * en quantité 1, validé d'office au scan sans écran de saisie.
 */
export function Checklist({ onClose }: { onClose: () => void }) {
  const session = useCarton((state) => state.session);
  const setCount = useCarton((state) => state.setCount);
  const removeExtra = useCarton((state) => state.removeExtra);

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OrderLine | null>(null);

  const { remaining, done } = useMemo(() => {
    const query = normalizeText(search);
    const digits = search.replace(/\D/g, "");
    const filtered = query
      ? session.lines.filter(
          (line) =>
            normalizeText(line.title).includes(query) ||
            normalizeText(line.author).includes(query) ||
            (digits.length > 0 && line.isbn.includes(digits)),
        )
      : session.lines;

    return {
      remaining: filtered.filter((line) => !isComplete(line)),
      done: filtered.filter(isComplete),
    };
  }, [session.lines, search]);

  if (editing) {
    return (
      <QuantitySheet
        line={editing}
        context="correction"
        onConfirm={(counted, damaged) => {
          setCount(editing.id, counted, damaged);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <Sheet
      open
      title={<h2 className="text-lg font-semibold">Avancement</h2>}
      footer={
        <div className="pb-2">
          <Button onClick={onClose}>Reprendre le scan</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Titre, auteur ou ISBN"
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 outline-none focus:border-blue-500"
        />

        {remaining.length > 0 ? (
          <section>
            <SectionTitle>Restant à trouver — {remaining.length}</SectionTitle>
            <div className="space-y-2">
              {remaining.map((line) => (
                <Row key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </div>
          </section>
        ) : null}

        {done.length > 0 ? (
          <section>
            <SectionTitle>Comptés — {done.length}</SectionTitle>
            <div className="space-y-2">
              {done.map((line) => (
                <Row key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </div>
            <p className="px-1 pt-2 text-xs text-slate-500">
              Touchez un titre pour corriger sa quantité ou signaler un exemplaire abîmé.
            </p>
          </section>
        ) : null}

        {session.extras.length > 0 ? (
          <section>
            <SectionTitle>Hors bon de commande</SectionTitle>
            <div className="space-y-2">
              {session.extras.map((extra) => (
                <div
                  key={extra.id}
                  className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm"
                >
                  <span className="font-mono text-sm">{formatIsbn(extra.isbn)}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-amber-600 tabular-nums">
                      ×{extra.counted}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExtra(extra.id)}
                      aria-label="Retirer"
                      className="text-sm font-semibold text-red-600"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

function Row({ line, onSelect }: { line: OrderLine; onSelect: () => void }) {
  const target = expected(line);
  const colour =
    surplus(line) > 0
      ? "text-amber-600"
      : isComplete(line)
        ? "text-emerald-600"
        : "text-slate-400";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm active:bg-slate-50"
    >
      <span className={`text-lg ${isComplete(line) ? "text-emerald-600" : "text-slate-300"}`}>
        {isComplete(line) ? "●" : "○"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{line.title}</span>
        <span className="block font-mono text-xs text-slate-500">{formatIsbn(line.isbn)}</span>
      </span>
      <span className="text-right">
        <span className={`block font-semibold tabular-nums ${colour}`}>
          {line.counted}/{target}
        </span>
        {line.damaged > 0 ? (
          <span className="block text-xs text-amber-600">{line.damaged} abîmé(s)</span>
        ) : null}
      </span>
    </button>
  );
}
