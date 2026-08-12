"use client";

import { useMemo, useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import {
  autoFixedLines,
  blockingIssues,
  declaredArticlesGap,
  declaredQuantityGap,
  displayPublisher,
  infoIssues,
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
  const articlesGap = declaredArticlesGap(session);
  const autoFixed = autoFixedLines(session);

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
        {degraded ? <Note tone="neutral">Un seul moteur a répondu sur certaines pages.</Note> : null}

        {autoFixed.length > 0 ? (
          <Note tone="neutral">
            {autoFixed.length === 1
              ? "1 ISBN divergent tranché par sa clé de contrôle."
              : `${autoFixed.length} ISBN divergents tranchés par leur clé de contrôle.`}
          </Note>
        ) : null}

        {gap !== null ? (
          <Note tone="neutral">
            Le bon annonce {session.declaredTotalQuantity} exemplaires, la lecture en totalise{" "}
            {readTotalQuantity(session)}.
            {gap < 0 ? " Un même ISBN figurait peut-être deux fois sur le bon." : ""}
          </Note>
        ) : null}

        {articlesGap !== null ? (
          <Note tone="neutral">
            Le bon annonce {session.declaredTotalArticles} références, la lecture en a{" "}
            {session.lines.length}.
            {articlesGap < 0
              ? " Une seconde ligne de libellé a peut-être été prise pour un titre."
              : " Une ligne a peut-être été sautée."}
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
                    {item.reason ? <span className="text-danger">{item.reason}</span> : null}
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
            <Label>ISBN ou quantité à trancher · {pending.length}</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {pending.map((line) => (
                <LineRow key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </ul>
          </section>
        ) : null}

        {confirmed.length > 0 ? (
          <section>
            <Label>Sans arbitrage · {confirmed.length}</Label>
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
          <span className={clean ? "text-success" : "text-danger"}>
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
  const blocking = Array.from(new Set(blockingIssues(line).map((issue) => issue.kind)));
  const notes = Array.from(new Set(infoIssues(line).map((issue) => issue.kind)));
  const flagged = blocking.length > 0;

  return (
    <li className="deferred-row border-b border-border last:border-0">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-3 bg-panel px-4 py-3 text-left hover:bg-subtle active:bg-subtle"
      >
        <span className={`mt-0.5 shrink-0 ${flagged ? "text-danger" : "text-success"}`}>
          {flagged ? <IconAlert /> : <IconCheck />}
        </span>

        {/*
          Trois informations portent le travail de réception : le titre pour
          reconnaître le livre, l'ISBN pour le scanner, la quantité pour savoir
          combien en sortir. L'éditeur ne sert qu'à départager deux titres
          voisins : il passe en gris clair, derrière les trois autres.
        */}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] font-medium ${line.title ? "" : "text-danger"}`}>
            {line.title || "Titre manquant"}
          </span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span
              className={`font-mono text-[12px] tabular-nums ${line.isbn ? "text-muted" : "text-danger"}`}
              translate="no"
            >
              {line.isbn ? formatIsbn(line.isbn) : "ISBN manquant"}
            </span>
            <span className="font-mono text-[12px] font-medium tabular-nums">
              {line.quantityOrdered === line.quantityDelivered
                ? `×${line.quantityDelivered}`
                : `${line.quantityOrdered}→${line.quantityDelivered}`}
            </span>
            <span className="truncate text-[11px] text-faint">{displayPublisher(line)}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 empty:mt-0">
            {blocking.map((kind) => (
              <Tag key={kind}>{ISSUE_LABELS[kind]}</Tag>
            ))}
            {notes.map((kind) => (
              <Tag key={kind} tone="neutral">
                {ISSUE_LABELS[kind]}
              </Tag>
            ))}
          </span>
        </span>

        <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-faint" />
      </button>
    </li>
  );
}
