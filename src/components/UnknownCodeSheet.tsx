"use client";

import { formatIsbn } from "@/lib/isbn";
import { Button, Sheet } from "./ui";

/**
 * Un code lu ne figure pas au bon de commande : soit le fournisseur a glissé un
 * livre non commandé, soit l'ISBN a été mal lu sur le papier. On ne tranche pas
 * à la place de l'opérateur.
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
  return (
    <Sheet
      open
      header={<h2 className="text-[15px] font-medium">Livre absent du bon</h2>}
      footer={
        <div className="space-y-2 pb-3">
          <Button variant="warning" onClick={onRecord}>
            Enregistrer hors commande
          </Button>
          <Button variant="secondary" onClick={onIgnore}>
            Ignorer
          </Button>
        </div>
      }
    >
      <p
        className="py-4 text-center font-mono text-[20px] tabular-nums select-all"
        translate="no"
      >
        {formatIsbn(code)}
      </p>
    </Sheet>
  );
}
