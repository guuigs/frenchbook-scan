"use client";

import { formatIsbn } from "@/lib/isbn";
import { Button, Sheet } from "./ui";

/**
 * Un code lu ne figure pas au bon de commande.
 *
 * Deux causes possibles, toutes deux normales : le fournisseur a glissé un
 * livre non commandé, ou l'ISBN a été mal lu sur le papier. On ne tranche pas à
 * la place de l'opérateur — on enregistre l'écart pour le récapitulatif.
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
      title={
        <>
          <div className="text-4xl">❓</div>
          <h2 className="mt-1 text-lg font-semibold">Livre absent du bon</h2>
        </>
      }
      footer={
        <div className="space-y-2 pb-2">
          <Button tone="warning" onClick={onRecord}>
            Enregistrer hors commande
          </Button>
          <Button tone="secondary" onClick={onIgnore}>
            Ignorer ce scan
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-center">
        <p className="font-mono text-xl select-all">{formatIsbn(code)}</p>
        <p className="text-sm text-slate-600">
          Ce code ne correspond à aucune ligne du bon de commande. Enregistrez-le comme livre hors
          commande, ou ignorez-le si c&apos;est une erreur de scan.
        </p>
      </div>
    </Sheet>
  );
}
