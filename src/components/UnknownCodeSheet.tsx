"use client";

import { formatIsbn, isValidIsbn } from "@/lib/isbn";
import { formatPressCode, readPressCode } from "@/lib/press";
import { Button, Note, Sheet } from "./ui";
import { IconAlert } from "./icons";

/**
 * Un code lu ne figure pas au bon de livraison.
 *
 * Quatre causes, toutes ordinaires : le fournisseur a glissé un livre non
 * commandé, l'ISBN a été mal lu sur le papier, l'objectif a attrapé un
 * code-barres qui n'est pas celui d'un livre — ou c'est une revue, dont le
 * code-barres ne contient tout simplement pas d'ISBN. On ne tranche pas à la
 * place de l'opérateur — mais on lui dit ce qu'on a lu et ce qu'on en pense.
 */
export function UnknownCodeSheet({
  code,
  onSearch,
  onRecord,
  onIgnore,
}: {
  code: string;
  onSearch: () => void;
  onRecord: () => void;
  onIgnore: () => void;
}) {
  const press = readPressCode(code);
  const looksLikeBook = isValidIsbn(code) && code.startsWith("97");

  /*
   * Sur une revue, « Enregistrer hors commande » est presque toujours le
   * mauvais geste : le titre est sur le bon, sous son ISBN, et c'est le
   * code-barres qui ne sait pas le dire. L'action principale devient donc la
   * recherche dans la liste — le reste ne bouge pas de place.
   */
  return (
    <Sheet
      open
      onDismiss={onIgnore}
      header={
        <div className="flex items-center gap-2">
          <IconAlert className="h-4 w-4 text-danger" />
          <h2 className="text-[15px] font-medium">{press ? "Revue" : "Absent du bon"}</h2>
        </div>
      }
      footer={
        <div className="space-y-2 pb-3">
          {press ? (
            <>
              <Button onClick={onSearch}>Chercher le titre dans le bon</Button>
              <Button variant="secondary" onClick={onRecord}>
                Enregistrer hors commande
              </Button>
              <Button variant="secondary" onClick={onIgnore}>
                Ignorer cette revue
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onRecord}>Enregistrer hors commande</Button>
              <Button variant="secondary" onClick={onIgnore}>
                Ignorer ce livre
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <p
          className="rounded-[10px] border border-border bg-subtle py-4 text-center font-mono text-[22px] tabular-nums select-all"
          translate="no"
        >
          {press ? formatPressCode(press) : code ? formatIsbn(code) : "code illisible"}
        </p>

        {press ? (
          <>
            <Note tone="neutral">
              Code-barres de presse : il porte le titre de la revue et son prix, jamais l’ISBN.
              Inutile d’en chercher un autre sur la couverture, il n’y en a pas.
            </Note>
            <p className="px-1 text-[12px] text-muted">
              L’ISBN de ce numéro est imprimé en clair à côté du code-barres. Saisissez-en les
              chiffres, ou le titre, dans la recherche pour retrouver la ligne du bon.
            </p>
          </>
        ) : looksLikeBook ? (
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
