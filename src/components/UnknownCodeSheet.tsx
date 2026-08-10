"use client";

import { formatIsbn, isValidIsbn } from "@/lib/isbn";
import { Button, Note, Sheet } from "./ui";
import { IconAlert } from "./icons";

/**
 * Un code lu ne figure pas au bon de livraison.
 *
 * Trois causes, toutes ordinaires : le fournisseur a glissé un livre non
 * commandé, l'ISBN a été mal lu sur le papier, ou l'objectif a attrapé un
 * code-barres qui n'est pas celui d'un livre. On ne tranche pas à la place de
 * l'opérateur — mais on lui dit ce qu'on a lu et ce qu'on en pense.
 */
export function UnknownCodeSheet({
  code,
  onRecord,
  onIgnore,
}: {
  code: string;
  onRecord: () => void;
  onIgnore: () => void;
}) {
  const looksLikeBook = isValidIsbn(code) && code.startsWith("97");

  return (
    <Sheet
      open
      onDismiss={onIgnore}
      header={
        <div className="flex items-center gap-2">
          <IconAlert className="h-4 w-4 text-danger" />
          <h2 className="text-[15px] font-medium">Absent du bon</h2>
        </div>
      }
      footer={
        <div className="space-y-2 pb-3">
          <Button onClick={onRecord}>
            Enregistrer hors commande
          </Button>
          <Button variant="secondary" onClick={onIgnore}>
            Ignorer ce livre
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p
          className="rounded-[10px] border border-border bg-subtle py-4 text-center font-mono text-[22px] tabular-nums select-all"
          translate="no"
        >
          {code ? formatIsbn(code) : "code illisible"}
        </p>

        {looksLikeBook ? (
          <Note tone="neutral">Ce livre ne figure sur aucune ligne du bon.</Note>
        ) : (
          <Note tone="danger">
            Ce code n’a pas la forme d’un ISBN. Vérifiez que c’est bien le code-barres du livre.
          </Note>
        )}

        <p className="px-1 text-[12px] text-muted">
          « Ignorer » écarte ce code une minute. Représentez le livre pour revenir dessus.
        </p>
      </div>
    </Sheet>
  );
}
