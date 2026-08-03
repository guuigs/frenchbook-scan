"use client";

import { useEffect, useState } from "react";

import { isValidIsbn, normalizeIsbn } from "@/lib/isbn";
import { loadPage } from "@/lib/pages";
import type { FieldIssue, LineField, OrderLine } from "@/lib/types";
import { Button, Sheet } from "./ui";

/**
 * Arbitrage d'une ligne douteuse.
 *
 * L'opérateur voit la photo de la page au-dessus du formulaire : trancher entre
 * deux lectures sans pouvoir consulter l'original ne serait qu'un tirage au
 * sort. Quand les moteurs divergent, les deux valeurs sont proposées en un
 * geste ; sinon le champ reste librement modifiable.
 */
export function LineEditor({
  line,
  onSave,
  onCancel,
  onDelete,
}: {
  line: OrderLine;
  onSave: (updated: OrderLine) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [isbn, setIsbn] = useState(line.isbn);
  const [title, setTitle] = useState(line.title);
  const [author, setAuthor] = useState(line.author);
  const [ordered, setOrdered] = useState(line.quantityOrdered);
  const [delivered, setDelivered] = useState(line.quantityDelivered);
  const [page, setPage] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadPage(line.pageIndex).then((dataUrl) => {
      if (active) setPage(dataUrl ?? null);
    });
    return () => {
      active = false;
    };
  }, [line.pageIndex]);

  const conflict = (field: LineField): FieldIssue | undefined =>
    line.issues.find((issue) => issue.field === field && issue.kind === "conflict");

  const singleSource = (field: LineField): FieldIssue | undefined =>
    line.issues.find((issue) => issue.field === field && issue.kind === "singleSource");

  const canSave = title.trim().length > 0 && isValidIsbn(isbn) && (ordered > 0 || delivered > 0);

  const save = () =>
    onSave({
      ...line,
      isbn: normalizeIsbn(isbn),
      title: title.trim(),
      author: author.trim(),
      quantityOrdered: ordered,
      quantityDelivered: delivered,
    });

  const candidates = (field: LineField, apply: (value: string) => void) => {
    const issue = conflict(field);
    if (issue) {
      return (
        <div className="mt-2">
          <p className="mb-1.5 text-xs text-slate-500">Les deux lectures diffèrent :</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Lecture 1", issue.candidateA],
              ["Lecture 2", issue.candidateB],
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => apply(value)}
                className="rounded-xl bg-slate-100 p-2.5 text-left active:bg-slate-200"
              >
                <span className="block text-[11px] text-slate-500">{label}</span>
                <span className="block text-sm font-medium break-words">{value || "(vide)"}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    const single = singleSource(field);
    if (single) {
      return (
        <p className="mt-2 text-xs text-amber-700">
          Ligne vue par une seule lecture — confirmez-la sur la photo.
        </p>
      );
    }
    return null;
  };

  return (
    <>
      <Sheet
        open
        title={<h2 className="text-lg font-semibold">Vérifier la ligne</h2>}
        footer={
          <div className="space-y-2 pb-2">
            <Button disabled={!canSave} tone="success" onClick={save}>
              Confirmer cette ligne
            </Button>
            <div className="flex gap-2">
              <Button tone="secondary" onClick={onCancel}>
                Annuler
              </Button>
              <Button
                tone="danger"
                onClick={() => {
                  if (confirm("Supprimer cette ligne du bon de commande ?")) onDelete();
                }}
              >
                Supprimer
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {page ? (
            <button type="button" onClick={() => setZoomed(true)} className="block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page}
                alt={`Page ${line.pageIndex + 1} du bon`}
                className="max-h-56 w-full rounded-xl border border-slate-200 bg-white object-contain"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Page {line.pageIndex + 1} — touchez pour agrandir et zoomer
              </span>
            </button>
          ) : null}

          <Field label="ISBN">
            <input
              value={isbn}
              onChange={(event) => setIsbn(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono outline-none focus:border-blue-500"
            />
            {isbn.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">Saisissez l&apos;ISBN relevé sur le bon.</p>
            ) : isValidIsbn(isbn) ? (
              <p className="mt-2 text-xs font-medium text-emerald-700">✓ Clé de contrôle valide.</p>
            ) : (
              <p className="mt-2 text-xs font-medium text-red-600">
                ✕ Clé de contrôle invalide — au moins un chiffre est erroné.
              </p>
            )}
            {candidates("isbn", (value) => setIsbn(normalizeIsbn(value)))}
          </Field>

          <Field label="Titre">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-blue-500"
            />
            {candidates("title", setTitle)}
          </Field>

          <Field label="Auteur">
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-blue-500"
            />
            {candidates("author", setAuthor)}
          </Field>

          <Field label="Quantité commandée">
            <Stepper value={ordered} onChange={setOrdered} />
            {candidates("quantityOrdered", (value) => setOrdered(Number(value.replace(/\D/g, "")) || 0))}
          </Field>

          <Field label="Quantité livrée">
            <Stepper value={delivered} onChange={setDelivered} />
            {candidates("quantityDelivered", (value) =>
              setDelivered(Number(value.replace(/\D/g, "")) || 0),
            )}
            <p className="mt-2 text-xs text-slate-500">
              {delivered < ordered
                ? `Reliquat de ${ordered - delivered} exemplaire(s) : le scan attendra ${delivered} exemplaire(s).`
                : `Le scan comptera ${Math.max(delivered, ordered)} exemplaire(s) pour ce titre.`}
            </p>
          </Field>
        </div>
      </Sheet>

      {zoomed && page ? (
        <div className="fixed inset-0 z-60 bg-black" onClick={() => setZoomed(false)}>
          <div className="h-full w-full overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page} alt="Page du bon agrandie" className="min-h-full w-auto max-w-none" />
          </div>
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="pt-safe absolute top-2 right-4 rounded-full bg-white/90 px-4 py-2 font-semibold"
          >
            Fermer
          </button>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(value - 1, 0))}
        className="h-12 w-12 rounded-xl bg-white text-xl font-semibold shadow-sm active:bg-slate-100"
      >
        −
      </button>
      <span className="min-w-12 text-center text-xl font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(value + 1, 999))}
        className="h-12 w-12 rounded-xl bg-white text-xl font-semibold shadow-sm active:bg-slate-100"
      >
        +
      </button>
    </div>
  );
}
