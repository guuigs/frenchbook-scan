"use client";

import { useRef, useState } from "react";

import {
  CHAMPS,
  FichierIllisible,
  construire,
  deviner,
  lireFichier,
  referenceDepuisNom,
  type CleChamp,
  type Correspondance,
  type Feuille,
} from "@/lib/import";
import { Button, Input, Label, Note, Panel, Spinner } from "./ui";
import { IconCheck, IconChevronRight, IconClose } from "./icons";

type Etape =
  | { nom: "fichier" }
  | { nom: "colonnes"; feuille: Feuille; correspondance: Correspondance; fichier: string }
  | { nom: "nom"; feuille: Feuille; correspondance: Correspondance; fichier: string }
  | { nom: "envoi" }
  | { nom: "fini"; inserees: number; reference: string };

/**
 * Dépôt d'une commande dans le référentiel, depuis un fichier.
 *
 * L'écran est découpé en quatre parce que chaque étape pose une question dont
 * la réponse conditionne la suivante — et parce qu'un import est difficile à
 * défaire : mieux vaut trois écrans qu'une commande de travers dans la base.
 *
 * La correspondance des colonnes est proposée, jamais imposée. Un fichier qui
 * ne vient pas du logiciel habituel n'a aucune raison d'avoir les mêmes
 * en-têtes, et une colonne devinée de travers ferait entrer des prix dans les
 * quantités sans que rien ne le signale.
 */
export function ImportOrder({ onClose }: { onClose: () => void }) {
  const [etape, setEtape] = useState<Etape>({ nom: "fichier" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);

  const [reference, setReference] = useState("");
  const [customer, setCustomer] = useState("");

  const choisir = async (fichier: File | undefined) => {
    if (!fichier) return;
    setErreur(null);
    setLecture(true);
    try {
      const feuille = await lireFichier(fichier);
      setReference(referenceDepuisNom(fichier.name));
      setEtape({
        nom: "colonnes",
        feuille,
        correspondance: deviner(feuille.entete),
        fichier: fichier.name,
      });
    } catch (cause) {
      setErreur(
        cause instanceof FichierIllisible ? cause.message : "Ce fichier n’a pas pu être lu.",
      );
    } finally {
      setLecture(false);
    }
  };

  const envoyer = async (feuille: Feuille, correspondance: Correspondance) => {
    const { lignes } = construire(feuille, correspondance);
    setErreur(null);
    setEtape({ nom: "envoi" });

    try {
      const response = await fetch("/api/orders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, customer, rows: lignes }),
      });
      const charge = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        throw new Error(
          charge && typeof charge.error === "string"
            ? charge.error
            : `L’import a échoué (${response.status}).`,
        );
      }

      setEtape({
        nom: "fini",
        inserees: typeof charge?.inserted === "number" ? charge.inserted : lignes.length,
        reference,
      });
    } catch (cause) {
      setErreur(
        cause instanceof Error && cause.message
          ? cause.message
          : "Réseau indisponible pendant l’envoi.",
      );
      // On revient à l'écran de nom : la correspondance est conservée, il n'y a
      // qu'à corriger la référence et réessayer.
      setEtape({ nom: "nom", feuille, correspondance, fichier: "" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="pt-safe flex items-center justify-between gap-3 border-b border-border px-4 pb-3">
        <h1 className="text-[15px] font-medium">Ajouter une commande</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted active:bg-subtle"
        >
          <IconClose />
        </button>
      </header>

      <div className="flex-1 overflow-auto px-4 py-4">
        {erreur ? (
          <Note tone="danger" className="mb-4" aria-live="polite">
            {erreur}
          </Note>
        ) : null}

        {etape.nom === "fichier" ? (
          <EtapeFichier lecture={lecture} onChoisir={() => champFichier.current?.click()} />
        ) : null}

        {etape.nom === "colonnes" ? (
          <EtapeColonnes
            etape={etape}
            onChange={(correspondance) => setEtape({ ...etape, correspondance })}
            onSuivant={() => setEtape({ ...etape, nom: "nom" })}
          />
        ) : null}

        {etape.nom === "nom" ? (
          <EtapeNom
            etape={etape}
            reference={reference}
            customer={customer}
            onReference={setReference}
            onCustomer={setCustomer}
            onEnvoyer={() => void envoyer(etape.feuille, etape.correspondance)}
            onRetour={() => setEtape({ ...etape, nom: "colonnes" })}
          />
        ) : null}

        {etape.nom === "envoi" ? (
          <p className="flex items-center justify-center gap-2.5 py-16 text-[14px] text-muted">
            <Spinner />
            Import en cours…
          </p>
        ) : null}

        {etape.nom === "fini" ? (
          <div className="flex flex-col items-center py-12 text-center">
            <span className="text-success">
              <IconCheck className="h-12 w-12" />
            </span>
            <p className="mt-4 font-mono text-[40px] leading-none font-medium tabular-nums">
              {etape.inserees}
            </p>
            <p className="mt-3 text-[15px] font-medium">
              ligne{etape.inserees > 1 ? "s" : ""} importée{etape.inserees > 1 ? "s" : ""}
            </p>
            <p className="mt-1 font-mono text-[12px] text-muted" translate="no">
              {etape.reference}
            </p>
            <p className="mt-4 text-[13px] text-muted">
              La commande est consultable au scan dès maintenant.
            </p>
          </div>
        ) : null}
      </div>

      <footer className="pb-safe border-t border-border px-4 pt-3">
        {etape.nom === "fini" ? (
          <Button onClick={onClose}>Terminer</Button>
        ) : (
          <Button variant="secondary" onClick={onClose} disabled={etape.nom === "envoi"}>
            Annuler
          </Button>
        )}
      </footer>

      <input
        ref={champFichier}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => {
          void choisir(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function EtapeFichier({ lecture, onChoisir }: { lecture: boolean; onChoisir: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-muted">
        Un fichier Excel (.xlsx) ou CSV exporté du logiciel de gestion. Rien n’est envoyé avant
        votre confirmation.
      </p>
      <Button onClick={onChoisir} disabled={lecture}>
        {lecture ? (
          <>
            <Spinner />
            Lecture…
          </>
        ) : (
          "Choisir un fichier"
        )}
      </Button>
    </div>
  );
}

function EtapeColonnes({
  etape,
  onChange,
  onSuivant,
}: {
  etape: Extract<Etape, { nom: "colonnes" }>;
  onChange: (correspondance: Correspondance) => void;
  onSuivant: () => void;
}) {
  const { feuille, correspondance, fichier } = etape;
  const apercu = construire(feuille, correspondance);
  const isbnManquant = correspondance.isbn === null || correspondance.isbn === undefined;

  return (
    <div className="space-y-4">
      <div>
        <Label>Fichier</Label>
        <Panel className="px-4 py-3">
          <p className="truncate text-[14px] font-medium">{fichier}</p>
          <p className="mt-0.5 font-mono text-[12px] text-muted tabular-nums">
            {feuille.lignes.length} ligne{feuille.lignes.length > 1 ? "s" : ""} ·{" "}
            {feuille.entete.length} colonne{feuille.entete.length > 1 ? "s" : ""}
          </p>
        </Panel>
      </div>

      <div>
        <Label>Correspondance des colonnes</Label>
        <div className="overflow-hidden rounded-[10px] border border-border">
          {CHAMPS.map(({ cle, libelle, requis }) => (
            <div
              key={cle}
              className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1 text-[14px]">
                {libelle}
                {requis ? <span className="ml-1 text-danger">*</span> : null}
              </span>
              <select
                aria-label={`Colonne pour ${libelle}`}
                value={correspondance[cle] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...correspondance,
                    [cle]: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className="min-h-11 max-w-[55%] shrink-0 rounded-[8px] border border-border bg-panel px-2 text-[14px] text-foreground"
              >
                <option value="">—</option>
                {feuille.entete.map((entete, index) => (
                  <option key={index} value={index}>
                    {entete || `Colonne ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {isbnManquant ? (
        <Note tone="danger">
          L’ISBN est indispensable : c’est lui que lit le lecteur de codes-barres.
        </Note>
      ) : (
        <Note tone={apercu.lignes.length > 0 ? "success" : "danger"} aria-live="polite">
          {apercu.lignes.length > 1
            ? `${apercu.lignes.length} livres seront importés`
            : `${apercu.lignes.length} livre sera importé`}
          {apercu.ecartees > 0
            ? ` · ${apercu.ecartees} ligne${apercu.ecartees > 1 ? "s" : ""} sans ISBN valide écartée${
                apercu.ecartees > 1 ? "s" : ""
              }`
            : ""}
          {apercu.doublons > 0
            ? ` · ${apercu.doublons} doublon${apercu.doublons > 1 ? "s" : ""} fusionné${
                apercu.doublons > 1 ? "s" : ""
              }`
            : ""}
        </Note>
      )}

      {/* Trois lignes suffisent à voir qu'une colonne est décalée. */}
      {apercu.lignes.length > 0 ? (
        <div>
          <Label>Aperçu</Label>
          <div className="overflow-hidden rounded-[10px] border border-border">
            {apercu.lignes.slice(0, 3).map((ligne) => (
              <div key={ligne.isbn} className="border-b border-border bg-panel px-4 py-2.5 last:border-0">
                <p className="truncate text-[14px]">{ligne.title || "— sans titre —"}</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted tabular-nums" translate="no">
                  {ligne.isbn} · ×{ligne.quantity_ordered}
                  {ligne.discount_rate !== null ? ` · ${ligne.discount_rate} %` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Button onClick={onSuivant} disabled={isbnManquant || apercu.lignes.length === 0}>
        Continuer
        <IconChevronRight />
      </Button>
    </div>
  );
}

function EtapeNom({
  etape,
  reference,
  customer,
  onReference,
  onCustomer,
  onEnvoyer,
  onRetour,
}: {
  etape: Extract<Etape, { nom: "nom" }>;
  reference: string;
  customer: string;
  onReference: (valeur: string) => void;
  onCustomer: (valeur: string) => void;
  onEnvoyer: () => void;
  onRetour: () => void;
}) {
  const apercu = construire(etape.feuille, etape.correspondance);
  const pret = reference.trim().length > 0 && customer.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <Label>Nom de la commande</Label>
        <Input
          value={customer}
          onChange={(event) => onCustomer(event.target.value)}
          placeholder="10899 - 24.08.26 - LIBRISTO MEDIA"
          autoComplete="off"
        />
        <p className="mt-1.5 text-[13px] text-muted">
          C’est ce nom que l’opérateur verra au scan et au récapitulatif du carton.
        </p>
      </div>

      <div>
        <Label>Référence</Label>
        <Input
          value={reference}
          onChange={(event) => onReference(event.target.value)}
          placeholder="Autre10899"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1.5 text-[13px] text-muted">
          Reprise du nom du fichier. Elle identifie la commande en base et ne peut pas être
          réutilisée : vérifiez-la avant d’importer.
        </p>
      </div>

      <Note tone="neutral">
        {apercu.lignes.length} livre{apercu.lignes.length > 1 ? "s" : ""} prêt
        {apercu.lignes.length > 1 ? "s" : ""} à être importé
        {apercu.lignes.length > 1 ? "s" : ""}.
      </Note>

      <Button onClick={onEnvoyer} disabled={!pret}>
        Importer dans le référentiel
      </Button>
      <Button variant="ghost" onClick={onRetour}>
        Revenir aux colonnes
      </Button>
    </div>
  );
}
