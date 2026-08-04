"use client";

import { useEffect, useId, useState } from "react";

import { isValidIsbn, normalizeIsbn } from "@/lib/isbn";
import { loadPage } from "@/lib/pages";
import type { FieldIssue, LineField, OrderLine } from "@/lib/types";
import { Button, Input, Sheet } from "./ui";
import { IconClose, IconMinus, IconPlus } from "./icons";

/**
 * Arbitrage d'une ligne douteuse.
 *
 * La photo de la page est au-dessus du formulaire : trancher entre deux
 * lectures sans pouvoir consulter l'original ne serait qu'un tirage au sort.
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
  const ids = useId();
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

  const isbnValid = isValidIsbn(isbn);
  const canSave = title.trim().length > 0 && isbnValid && (ordered > 0 || delivered > 0);

  const candidates = (field: LineField, apply: (value: string) => void) => {
    const issue = conflict(field);
    if (!issue) return null;
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[issue.candidateA, issue.candidateB].map((value, index) => (
          <button
            key={index}
            type="button"
            onClick={() => apply(value)}
            className="rounded-[8px] border border-border bg-panel px-2.5 py-2 text-left hover:border-border-strong active:bg-subtle"
          >
            <span className="block font-mono text-[10px] text-faint">Lecture {index + 1}</span>
            <span className="block text-[13px] break-words">{value || "(vide)"}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      <Sheet
        open
        header={<h2 className="text-[15px] font-medium">Vérifier la ligne</h2>}
        footer={
          <div className="space-y-2 pb-3">
            <Button disabled={!canSave} onClick={() =>
              onSave({
                ...line,
                isbn: normalizeIsbn(isbn),
                title: title.trim(),
                author: author.trim(),
                quantityOrdered: ordered,
                quantityDelivered: delivered,
              })
            }>
              Confirmer
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={onCancel}>
                Annuler
              </Button>
              <Button variant="secondaryDanger" onClick={onDelete}>
                Supprimer
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {page ? (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Agrandir la page du bon"
              className="block w-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page}
                alt={`Page ${line.pageIndex + 1} du bon de commande`}
                width={800}
                height={560}
                className="max-h-48 w-full rounded-[8px] border border-border bg-subtle object-contain"
              />
            </button>
          ) : null}

          <div>
            <label htmlFor={`${ids}-isbn`} className="mb-1.5 block text-[13px] text-muted">
              ISBN
            </label>
            <Input
              id={`${ids}-isbn`}
              value={isbn}
              onChange={(event) => setIsbn(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              translate="no"
              placeholder="9782070368228"
              className="font-mono"
            />
            {isbn ? (
              <p
                className={`mt-1.5 font-mono text-[11px] ${isbnValid ? "text-success" : "text-danger"}`}
                aria-live="polite"
              >
                {isbnValid ? "clé valide" : "clé invalide"}
              </p>
            ) : null}
            {candidates("isbn", (value) => setIsbn(normalizeIsbn(value)))}
          </div>

          <div>
            <label htmlFor={`${ids}-title`} className="mb-1.5 block text-[13px] text-muted">
              Titre
            </label>
            <Input
              id={`${ids}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
            />
            {candidates("title", setTitle)}
          </div>

          <div>
            <label htmlFor={`${ids}-author`} className="mb-1.5 block text-[13px] text-muted">
              Auteur
            </label>
            <Input
              id={`${ids}-author`}
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              autoComplete="off"
            />
            {candidates("author", setAuthor)}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-[13px] text-muted">Commandé</p>
              <Stepper label="commandée" value={ordered} onChange={setOrdered} />
              {candidates("quantityOrdered", (v) => setOrdered(Number(v.replace(/\D/g, "")) || 0))}
            </div>
            <div>
              <p className="mb-1.5 text-[13px] text-muted">Livré</p>
              <Stepper label="livrée" value={delivered} onChange={setDelivered} />
              {candidates("quantityDelivered", (v) => setDelivered(Number(v.replace(/\D/g, "")) || 0))}
            </div>
          </div>
        </div>
      </Sheet>

      {zoomed && page ? (
        <div className="fixed inset-0 z-60 bg-black">
          <div className="h-full w-full overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page} alt="Page du bon agrandie" className="min-h-full w-auto max-w-none" />
          </div>
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Fermer"
            className="pt-safe absolute top-2 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black"
          >
            <IconClose />
          </button>
        </div>
      ) : null}
    </>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(value - 1, 0))}
        aria-label={`Diminuer la quantité ${label}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
      >
        <IconMinus />
      </button>
      <span className="flex-1 text-center font-mono text-[17px] font-medium tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(value + 1, 999))}
        aria-label={`Augmenter la quantité ${label}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-border hover:border-border-strong active:bg-subtle"
      >
        <IconPlus />
      </button>
    </div>
  );
}
