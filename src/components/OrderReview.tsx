"use client";

import { useMemo, useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import {
  declaredQuantityGap,
  displayPublisher,
  isReviewComplete,
  needsReview,
  readTotalQuantity,
  totalExpected,
} from "@/lib/order";
import { ISSUE_LABELS, type OrderLine } from "@/lib/types";
import { ActionBar, Button, Dialog, Label, Note, Tag } from "./ui";
import { IconAlert, IconCheck, IconChevronRight, IconPlus } from "./icons";
import { LineEditor } from "./LineEditor";

/**
 * Contrôle du bon de commande lu.
 *
 * Les lignes à vérifier remontent en tête : l'opérateur descend jusqu'à ce que
 * le compteur tombe à zéro, sans relire ce que les deux moteurs ont lu à
 * l'identique.
 */
export function OrderReview() {
  const session = useCarton((state) => state.session);
  const degraded = useCarton((state) => state.degraded);
  const resolveLine = useCarton((state) => state.resolveLine);
  const deleteLine = useCarton((state) => state.deleteLine);
  const addManualLine = useCarton((state) => state.addManualLine);
  const validateOrder = useCarton((state) => state.validateOrder);
  const abandonCarton = useCarton((state) => state.abandonCarton);

  const [editing, setEditing] = useState<OrderLine | null>(null);
  const [dialog, setDialog] = useState<"validate" | "abandon" | null>(null);

  const { pending, confirmed } = useMemo(
    () => ({
      pending: session.lines.filter(needsReview),
      confirmed: session.lines.filter((line) => !needsReview(line)),
    }),
    [session.lines],
  );

  const clean = isReviewComplete(session);
  const gap = declaredQuantityGap(session);

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-4">
        <button
          type="button"
          onClick={() => setDialog("abandon")}
          className="text-[14px] text-muted hover:text-danger"
        >
          Abandonner
        </button>
        <h1 className="text-[15px] font-medium">Bon de commande</h1>
        <button
          type="button"
          onClick={() => setEditing(addManualLine())}
          aria-label="Ajouter une ligne"
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground active:bg-subtle"
        >
          <IconPlus />
        </button>
      </header>

      <div className="flex-1 space-y-4 px-4 pb-6">
        {degraded ? <Note tone="warning">Un seul moteur a répondu sur certaines pages.</Note> : null}

        {gap !== null ? (
          <Note tone="warning">
            Le bon annonce {session.declaredTotalQuantity} exemplaires, la lecture en totalise{" "}
            {readTotalQuantity(session)}.
          </Note>
        ) : null}

        {session.notDelivered.length > 0 ? (
          <section>
            <Label>Annoncés non livrés · {session.notDelivered.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {session.notDelivered.map((item) => (
                <li key={item.id} className="border-b border-border bg-panel px-4 py-3 last:border-0">
                  <p className="text-[14px]">{item.title || "Titre non lu"}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-faint tabular-nums">
                    <span translate="no">{item.isbn ? formatIsbn(item.isbn) : "ISBN non lu"}</span>
                    <span>×{item.quantity}</span>
                    {item.reason ? <span className="text-warning">{item.reason}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
            <p className="px-1 pt-2 text-[12px] text-muted">
              Absents du carton : ils ne sont pas à scanner.
            </p>
          </section>
        ) : null}

        {pending.length > 0 ? (
          <section>
            <Label>À vérifier · {pending.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {pending.map((line) => (
                <LineRow key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </ul>
          </section>
        ) : null}

        {confirmed.length > 0 ? (
          <section>
            <Label>Vérifiées · {confirmed.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {confirmed.map((line) => (
                <LineRow key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <ActionBar>
        <div className="flex items-center justify-between pb-2.5 font-mono text-[12px] text-muted tabular-nums">
          <span>
            {session.lines.length} titres · {totalExpected(session)} exemplaires
          </span>
          <span className={clean ? "text-success" : "text-warning"}>
            {clean ? "vérifié" : `${pending.length} à vérifier`}
          </span>
        </div>
        <Button disabled={!clean || session.lines.length === 0} onClick={() => setDialog("validate")}>
          Passer au scan
        </Button>
        <div className="h-3" />
      </ActionBar>

      {editing ? (
        <LineEditor
          line={editing}
          onCancel={() => setEditing(null)}
          onDelete={() => {
            deleteLine(editing.id);
            setEditing(null);
          }}
          onSave={(updated) => {
            resolveLine(editing.id, updated);
            setEditing(null);
          }}
        />
      ) : null}

      {dialog === "validate" ? (
        <Dialog
          title="Passer au scan ?"
          body={`${session.lines.length} titres, ${totalExpected(session)} exemplaires attendus.`}
          onDismiss={() => setDialog(null)}
        >
          <Button
            onClick={() => {
              setDialog(null);
              validateOrder();
            }}
          >
            Commencer le scan
          </Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Revoir
          </Button>
        </Dialog>
      ) : null}

      {dialog === "abandon" ? (
        <Dialog
          title="Abandonner ce carton ?"
          body="Le bon lu et ses photos seront supprimés."
          onDismiss={() => setDialog(null)}
        >
          <Button variant="danger" onClick={() => void abandonCarton()}>
            Abandonner
          </Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Continuer
          </Button>
        </Dialog>
      ) : null}
    </main>
  );
}

function LineRow({ line, onSelect }: { line: OrderLine; onSelect: () => void }) {
  const kinds = Array.from(new Set(line.issues.map((issue) => issue.kind)));
  const flagged = line.issues.length > 0;

  return (
    <li className="deferred-row border-b border-border last:border-0">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-3 bg-panel px-4 py-3 text-left hover:bg-subtle active:bg-subtle"
      >
        <span className={`mt-0.5 shrink-0 ${flagged ? "text-warning" : "text-success"}`}>
          {flagged ? <IconAlert /> : <IconCheck />}
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] font-medium ${line.title ? "" : "text-danger"}`}>
            {line.title || "Titre manquant"}
          </span>
          <span className="block truncate text-[13px] text-muted">{displayPublisher(line)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`font-mono text-[11px] tabular-nums ${line.isbn ? "text-faint" : "text-danger"}`}
              translate="no"
            >
              {line.isbn ? formatIsbn(line.isbn) : "ISBN manquant"}
            </span>
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {line.quantityOrdered}→{line.quantityDelivered}
            </span>
            {kinds.map((kind) => (
              <Tag key={kind}>{ISSUE_LABELS[kind]}</Tag>
            ))}
          </span>
        </span>

        <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-faint" />
      </button>
    </li>
  );
}
