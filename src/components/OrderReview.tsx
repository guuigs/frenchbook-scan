"use client";

import { useMemo, useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import { displayAuthor, isReviewComplete, needsReview, totalExpected } from "@/lib/order";
import { ISSUE_LABELS, type OrderLine } from "@/lib/types";
import { ActionBar, Banner, Button, Chip, SectionTitle } from "./ui";
import { LineEditor } from "./LineEditor";

/**
 * Contrôle du bon de commande lu.
 *
 * Le tri est délibéré : les lignes à vérifier remontent en tête. L'opérateur
 * travaille de haut en bas jusqu'à ce que le bandeau passe au vert, sans avoir
 * à relire les lignes que les deux moteurs ont lues à l'identique.
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
  const [confirmingValidation, setConfirmingValidation] = useState(false);

  const { pending, confirmed } = useMemo(
    () => ({
      pending: session.lines.filter(needsReview),
      confirmed: session.lines.filter((line) => !needsReview(line)),
    }),
    [session.lines],
  );

  const clean = isReviewComplete(session);

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-2">
        <button
          type="button"
          onClick={() => {
            if (confirm("Abandonner ce carton ? Le bon lu et ses photos seront supprimés.")) {
              void abandonCarton();
            }
          }}
          className="text-sm font-semibold text-red-600"
        >
          Abandonner
        </button>
        <h1 className="font-semibold">Bon de commande</h1>
        <button
          type="button"
          onClick={() => setEditing(addManualLine())}
          aria-label="Ajouter une ligne manquante"
          className="text-xl font-semibold text-blue-600"
        >
          +
        </button>
      </header>

      <div className="flex-1 space-y-5 px-4 pb-6">
        <Banner
          tone={clean ? "ok" : "warning"}
          title={clean ? "Lecture vérifiée" : `${pending.length} ligne(s) à vérifier`}
        >
          {clean
            ? "Toutes les lignes concordent entre les deux lectures."
            : "Les deux lectures divergent ou une clé ISBN est invalide."}
        </Banner>

        {degraded ? (
          <Banner tone="warning" title="Vérification croisée dégradée">
            Un seul moteur a répondu sur au moins une page. Ces lignes sont marquées « source
            unique » : contrôlez-les sur la photo avec attention.
          </Banner>
        ) : null}

        {pending.length > 0 ? (
          <section>
            <SectionTitle>À vérifier — {pending.length}</SectionTitle>
            <div className="space-y-2">
              {pending.map((line) => (
                <LineRow key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </div>
            <p className="px-1 pt-2 text-xs text-slate-500">
              Touchez une ligne pour trancher entre les deux lectures ou corriger la valeur.
            </p>
          </section>
        ) : null}

        {confirmed.length > 0 ? (
          <section>
            <SectionTitle>Lecture concordante — {confirmed.length}</SectionTitle>
            <div className="space-y-2">
              {confirmed.map((line) => (
                <LineRow key={line.id} line={line} onSelect={() => setEditing(line)} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <ActionBar>
        <div className="flex gap-3 pb-2 text-xs text-slate-500">
          <span>
            <strong className="text-slate-900 tabular-nums">{session.lines.length}</strong> titres
          </span>
          <span>
            <strong className="text-slate-900 tabular-nums">{totalExpected(session)}</strong>{" "}
            exemplaires
          </span>
        </div>
        <Button disabled={!clean || session.lines.length === 0} onClick={() => setConfirmingValidation(true)}>
          Valider et passer au scan
        </Button>
        <div className="h-2" />
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

      {confirmingValidation ? (
        <ConfirmValidation
          titles={session.lines.length}
          copies={totalExpected(session)}
          onCancel={() => setConfirmingValidation(false)}
          onConfirm={() => {
            setConfirmingValidation(false);
            validateOrder();
          }}
        />
      ) : null}
    </main>
  );
}

function LineRow({ line, onSelect }: { line: OrderLine; onSelect: () => void }) {
  const kinds = Array.from(new Set(line.issues.map((issue) => issue.kind)));

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm active:bg-slate-50"
    >
      <span className={`mt-0.5 text-lg ${line.issues.length ? "text-amber-500" : "text-emerald-600"}`}>
        {line.issues.length ? "⚠" : "✓"}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block font-medium ${line.title ? "" : "text-red-600"}`}>
          {line.title || "Titre manquant"}
        </span>
        <span className="block truncate text-sm text-slate-500">{displayAuthor(line)}</span>
        <span className="mt-1 block text-xs text-slate-500">
          <span className={`font-mono ${line.isbn ? "" : "text-red-600"}`}>
            {line.isbn ? formatIsbn(line.isbn) : "ISBN manquant"}
          </span>
          <span className="tabular-nums">
            {" · "}cdé {line.quantityOrdered} · livré {line.quantityDelivered}
          </span>
        </span>
        {kinds.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <Chip key={kind}>{ISSUE_LABELS[kind]}</Chip>
            ))}
          </span>
        ) : null}
      </span>

      <span className="mt-1 text-slate-300">›</span>
    </button>
  );
}

function ConfirmValidation({
  titles,
  copies,
  onCancel,
  onConfirm,
}: {
  titles: number;
  copies: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <h2 className="text-lg font-semibold">Valider le bon de commande ?</h2>
        <p className="mt-2 text-sm text-slate-600">
          {titles} titre(s), {copies} exemplaire(s) attendus. Vous passez au comptage physique.
        </p>
        <div className="mt-5 space-y-2">
          <Button onClick={onConfirm}>Valider et scanner les livres</Button>
          <Button tone="secondary" onClick={onCancel}>
            Revoir
          </Button>
        </div>
      </div>
    </div>
  );
}
