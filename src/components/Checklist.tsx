"use client";

import { useMemo, useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import { normalizeText } from "@/lib/reconciler";
import { expected, isComplete, surplus } from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { Button, Input, Label, Sheet } from "./ui";
import { IconCheck } from "./icons";
import { QuantitySheet } from "./QuantitySheet";

/**
 * Avancement pendant le scan. Deux usages : retrouver un titre dans un gros
 * carton, et corriger une ligne déjà comptée — c'est le seul endroit où
 * signaler un exemplaire abîmé sur un titre en quantité 1, validé d'office.
 */
export function Checklist({ onClose }: { onClose: () => void }) {
  const session = useCarton((state) => state.session);
  const confirmScan = useCarton((state) => state.confirmScan);
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
            normalizeText(line.publisher).includes(query) ||
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
        onConfirm={({ counted, damaged, allocations }) => {
          confirmScan(editing.id, counted, damaged, allocations);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <Sheet
      open
      onDismiss={onClose}
      header={<h2 className="text-[15px] font-medium">Avancement</h2>}
      footer={
        <div className="pb-3">
          <Button onClick={onClose}>Reprendre le scan</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Rechercher un titre"
          type="search"
          autoComplete="off"
          placeholder="Titre, éditeur ou ISBN…"
        />

        {remaining.length > 0 ? (
          <section>
            <Label>Restant · {remaining.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {remaining.map((line) => (
                <Row key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </ul>
          </section>
        ) : null}

        {done.length > 0 ? (
          <section>
            <Label>Comptés · {done.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {done.map((line) => (
                <Row key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </ul>
          </section>
        ) : null}

        {session.extras.length > 0 ? (
          <section>
            <Label>Hors bon · {session.extras.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {session.extras.map((extra) => (
                <li
                  key={extra.id}
                  className="flex items-center justify-between border-b border-border bg-panel px-4 py-3 last:border-0"
                >
                  <span className="font-mono text-[13px] tabular-nums" translate="no">
                    {formatIsbn(extra.isbn)}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-[13px] text-danger tabular-nums">
                      ×{extra.counted}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExtra(extra.id)}
                      className="text-[13px] text-muted hover:text-danger"
                    >
                      Retirer
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

function Row({ line, onSelect }: { line: OrderLine; onSelect: () => void }) {
  const target = expected(line);
  const complete = isComplete(line);
  const colour = surplus(line) > 0 ? "text-danger" : complete ? "text-success" : "text-faint";

  return (
    <li className="deferred-row border-b border-border last:border-0">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 bg-panel px-4 py-3 text-left hover:bg-subtle active:bg-subtle"
      >
        <span className={`shrink-0 ${complete ? "text-success" : "text-faint"}`}>
          {complete ? (
            <IconCheck className="h-4 w-4" />
          ) : (
            <span className="block h-3.5 w-3.5 rounded-full border border-current" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{line.title}</span>
          <span className="block font-mono text-[11px] text-faint tabular-nums" translate="no">
            {formatIsbn(line.isbn)}
          </span>
        </span>
        <span className="text-right">
          <span className={`block font-mono text-[14px] tabular-nums ${colour}`}>
            {line.counted}/{target}
          </span>
          {line.damaged > 0 ? (
            <span className="block font-mono text-[10px] text-danger">{line.damaged} abîmé</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
