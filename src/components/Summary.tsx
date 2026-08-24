"use client";

import { useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import { MAIL_RECIPIENT, buildExportFiles, importRows, mailCsv, shareOrDownload } from "@/lib/export";
import {
  allocationsByOrder,
  backorder,
  backorderedLines,
  damagedLines,
  expected,
  hasAnomalies,
  missingLines,
  shortfall,
  surplus,
  surplusLines,
  totalCounted,
  totalDamaged,
  totalExpected,
  totalExtras,
  totalMissing,
  totalSurplus,
  unallocatedTotal,
} from "@/lib/order";
import type { CartonSession, OrderLine } from "@/lib/types";
import { ActionBar, Button, Dialog, Label, Note, Row } from "./ui";
import { IconChevronLeft, IconMail, IconShare } from "./icons";

export function Summary() {
  const session = useCarton((state) => state.session);
  const returnToScanning = useCarton((state) => state.returnToScanning);
  const closeCarton = useCarton((state) => state.closeCarton);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [mailState, setMailState] = useState<"idle" | "sending" | "sent">("idle");
  const [mailError, setMailError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const conform = !hasAnomalies(session);
  const tallies = allocationsByOrder(session);
  const loose = unallocatedTotal(session);
  const toImport = importRows(session);
  const copiesToImport = toImport.reduce((sum, row) => sum + row.quantity, 0);

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await shareOrDownload(await buildExportFiles(session));
      setExported(true);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "L’export a échoué. Réessayez.",
      );
    } finally {
      setExporting(false);
    }
  };

  const runMail = async () => {
    setMailState("sending");
    setMailError(null);
    try {
      await mailCsv(session);
      setMailState("sent");
    } catch (error) {
      setMailState("idle");
      setMailError(error instanceof Error ? error.message : "L’envoi a échoué. Réessayez.");
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-4">
        <button
          type="button"
          onClick={returnToScanning}
          className="flex items-center gap-1 text-[14px] text-muted hover:text-foreground"
        >
          <IconChevronLeft />
          Scan
        </button>
        <h1 className="text-[15px] font-medium">Fin du carton</h1>
        <span className="w-14" />
      </header>

      <div className="flex-1 space-y-4 px-4 pb-6">
        <Note tone={conform ? "success" : "danger"}>
          {conform ? "Carton conforme" : "Écarts constatés"}
        </Note>

        <section>
          <Label>Synthèse</Label>
          <div className="rounded-[10px] border border-border">
            <Row label="Titres" value={session.lines.length} />
            <Row label="Attendus" value={totalExpected(session)} />
            <Row label="Comptés" value={totalCounted(session)} />
            {totalMissing(session) > 0 ? (
              <Row label="Manquants" value={totalMissing(session)} tone="danger" />
            ) : null}
            {totalSurplus(session) > 0 ? (
              <Row label="Surplus" value={totalSurplus(session)} tone="danger" />
            ) : null}
            {totalDamaged(session) > 0 ? (
              <Row label="Abîmés" value={totalDamaged(session)} tone="danger" />
            ) : null}
            {totalExtras(session) > 0 ? (
              <Row label="Hors bon" value={totalExtras(session)} tone="danger" />
            ) : null}
          </div>
        </section>

        <Anomalies
          title="Manques"
          lines={missingLines(session)}
          detail={(line) => `−${shortfall(line)}`}
          tone="text-danger"
        />
        <Anomalies
          title="Surplus"
          lines={surplusLines(session)}
          detail={(line) => `+${surplus(line)}`}
          tone="text-danger"
        />
        <Anomalies
          title="Abîmés"
          lines={damagedLines(session)}
          detail={(line) => `${line.damaged}`}
          tone="text-danger"
        />

        {session.extras.length > 0 ? (
          <section>
            <Label>Hors bon de commande</Label>
            <ul className="rounded-[10px] border border-border">
              {session.extras.map((extra) => (
                <li
                  key={extra.id}
                  className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0"
                >
                  <span className="font-mono text-[13px] tabular-nums" translate="no">
                    {formatIsbn(extra.isbn)}
                  </span>
                  <span className="font-mono text-[13px] text-danger tabular-nums">
                    ×{extra.counted}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {session.notDelivered.length > 0 ? (
          <section>
            <Label>Annoncés non livrés · {session.notDelivered.length}</Label>
            <ul className="rounded-[10px] border border-border">
              {session.notDelivered.map((item) => (
                <li key={item.id} className="border-b border-border px-4 py-3 last:border-0">
                  <p className="text-[14px]">{item.title || "Titre non lu"}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-faint tabular-nums">
                    <span translate="no">{item.isbn ? formatIsbn(item.isbn) : "ISBN non lu"}</span>
                    <span>×{item.quantity}</span>
                    {item.reason ? <span className="text-danger">{item.reason}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tallies.length > 0 || loose > 0 ? (
          <section>
            <Label>Répartition par commande</Label>
            <ul className="overflow-hidden rounded-[10px] border border-border">
              {tallies.map((tally) => (
                <li
                  key={tally.orderReference}
                  className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3 last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">
                      {tally.customer || "Client non renseigné"}
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-faint" translate="no">
                      {tally.orderReference}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[14px] font-medium tabular-nums">
                    ×{tally.quantity}
                  </span>
                </li>
              ))}
              {loose > 0 ? (
                <li className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3 last:border-0">
                  <span className="min-w-0 flex-1 text-[14px] text-muted">
                    Sans commande — entrée de stock
                  </span>
                  <span className="shrink-0 font-mono text-[14px] font-medium tabular-nums">
                    ×{loose}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <Anomalies
          title="Reliquats annoncés au bon"
          lines={backorderedLines(session)}
          detail={(line) => `${backorder(line)} en attente`}
          tone="text-muted"
        />

        <section>
          <Label>Export</Label>
          <Button variant="secondary" disabled={exporting} onClick={() => void runExport()}>
            <IconShare />
            {exporting ? "Génération…" : exported ? "Exporter à nouveau" : "Exporter PDF + CSV"}
          </Button>
          {/*
            L'opérateur repart avec deux fichiers qui ne servent pas à la même
            chose : autant le dire avant qu'il ne les ouvre.
          */}
          <p className="px-1 pt-2 text-[12px] text-muted">
            PDF : le récapitulatif complet, écarts compris. CSV : la liste à importer dans
            Librisoft — {toImport.length} titre{toImport.length > 1 ? "s" : ""},{" "}
            {copiesToImport} exemplaire{copiesToImport > 1 ? "s" : ""}, sans les manquants ni les
            abîmés.
          </p>
          {exportError ? (
            <Note tone="danger" className="mt-2" aria-live="polite">
              {exportError}
            </Note>
          ) : null}

          <div className="mt-2">
            <Button
              variant="secondary"
              disabled={mailState === "sending" || toImport.length === 0}
              onClick={() => void runMail()}
            >
              <IconMail />
              {mailState === "sending"
                ? "Envoi…"
                : mailState === "sent"
                  ? "Renvoyer le CSV par mail"
                  : "Envoyer le CSV par mail"}
            </Button>
            {mailState === "sent" ? (
              <Note tone="success" className="mt-2" aria-live="polite">
                CSV envoyé à {MAIL_RECIPIENT}.
              </Note>
            ) : (
              <p className="px-1 pt-2 text-[12px] text-muted">
                Vers {MAIL_RECIPIENT}, objet « csv commande n°
                {session.reference.trim() || "sans référence"} ».
              </p>
            )}
            {mailError ? (
              <Note tone="danger" className="mt-2" aria-live="polite">
                {mailError}
              </Note>
            ) : null}
          </div>
        </section>      </div>

      <ActionBar>
        <Button onClick={() => setConfirming(true)}>Clôturer le carton</Button>
        <div className="h-3" />
      </ActionBar>

      {confirming ? (
        <Dialog
          title="Clôturer définitivement ?"
          body={
            <>
              {describeAnomalies(session)} Toutes les données de ce carton seront effacées.
              {exported ? "" : " Le récapitulatif n’a pas été exporté."}
            </>
          }
          onDismiss={() => setConfirming(false)}
        >
          <Button variant="danger" onClick={() => void closeCarton()}>
            Clôturer et effacer
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Annuler
          </Button>
        </Dialog>
      ) : null}
    </main>
  );
}

function Anomalies({
  title,
  lines,
  detail,
  tone,
}: {
  title: string;
  lines: OrderLine[];
  detail: (line: OrderLine) => string;
  tone: string;
}) {
  if (lines.length === 0) return null;

  return (
    <section>
      <Label>
        {title} · {lines.length}
      </Label>
      <ul className="rounded-[10px] border border-border">
        {lines.map((line) => (
          <li
            key={line.id}
            className="deferred-row flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px]">{line.title}</span>
              <span className="block font-mono text-[11px] text-faint tabular-nums" translate="no">
                {formatIsbn(line.isbn)}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`block font-mono text-[14px] tabular-nums ${tone}`}>
                {detail(line)}
              </span>
              <span className="block font-mono text-[11px] text-faint tabular-nums">
                {line.counted}/{expected(line)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function describeAnomalies(session: CartonSession): string {
  const parts: string[] = [];
  if (totalMissing(session) > 0) parts.push(`${totalMissing(session)} manquants`);
  if (totalSurplus(session) > 0) parts.push(`${totalSurplus(session)} en surplus`);
  if (totalDamaged(session) > 0) parts.push(`${totalDamaged(session)} abîmés`);
  if (totalExtras(session) > 0) parts.push(`${totalExtras(session)} hors commande`);
  return parts.length > 0 ? `${parts.join(", ")}.` : "Aucun écart.";
}
