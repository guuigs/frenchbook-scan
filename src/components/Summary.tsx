"use client";

import { useState } from "react";

import { useCarton } from "@/lib/store";
import { formatIsbn } from "@/lib/isbn";
import { buildExportFiles, shareOrDownload } from "@/lib/export";
import {
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
} from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { ActionBar, Banner, Button, Card, SectionTitle, StatRow } from "./ui";

/**
 * Récapitulatif de fin de carton, avant clôture définitive.
 *
 * C'est le dernier point où les données existent encore : la clôture purge
 * tout. L'export est donc proposé ici, pas après.
 */
export function Summary() {
  const session = useCarton((state) => state.session);
  const returnToScanning = useCarton((state) => state.returnToScanning);
  const closeCarton = useCarton((state) => state.closeCarton);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const conform = !hasAnomalies(session);

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const files = await buildExportFiles(session);
      await shareOrDownload(files);
      setExported(true);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "L'export n'a pas pu être généré.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-2">
        <button type="button" onClick={returnToScanning} className="text-sm font-semibold text-blue-600">
          ‹ Reprendre le scan
        </button>
        <h1 className="font-semibold">Fin du carton</h1>
        <span className="w-24" />
      </header>

      <div className="flex-1 space-y-5 px-4 pb-6">
        <Banner
          tone={conform ? "ok" : "warning"}
          title={conform ? "Carton conforme" : "Écarts constatés"}
        >
          {conform
            ? "Tous les exemplaires annoncés ont été comptés."
            : "Vérifiez les écarts ci-dessous avant de clôturer."}
        </Banner>

        <section>
          <SectionTitle>Synthèse</SectionTitle>
          <Card>
            <StatRow label="Titres au bon" value={session.lines.length} />
            <StatRow label="Exemplaires attendus" value={totalExpected(session)} />
            <StatRow label="Exemplaires comptés" value={totalCounted(session)} />
            {totalMissing(session) > 0 ? (
              <StatRow label="Manquants" value={totalMissing(session)} tone="danger" />
            ) : null}
            {totalSurplus(session) > 0 ? (
              <StatRow label="En surplus" value={totalSurplus(session)} tone="warning" />
            ) : null}
            {totalDamaged(session) > 0 ? (
              <StatRow label="Abîmés" value={totalDamaged(session)} tone="warning" />
            ) : null}
            {totalExtras(session) > 0 ? (
              <StatRow label="Hors bon de commande" value={totalExtras(session)} tone="warning" />
            ) : null}
          </Card>
        </section>

        <AnomalySection
          title="Manques"
          note="Ces titres n'ont pas été trouvés en totalité dans le carton."
          lines={missingLines(session)}
          detail={(line) => `${shortfall(line)} manquant(s)`}
          tone="text-red-600"
        />

        <AnomalySection
          title="Surplus"
          lines={surplusLines(session)}
          detail={(line) => `+${surplus(line)}`}
          tone="text-amber-600"
        />

        <AnomalySection
          title="Livres abîmés"
          lines={damagedLines(session)}
          detail={(line) => `${line.damaged} abîmé(s)`}
          tone="text-amber-600"
        />

        {session.extras.length > 0 ? (
          <section>
            <SectionTitle>Hors bon de commande</SectionTitle>
            <Card>
              {session.extras.map((extra) => (
                <div
                  key={extra.id}
                  className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0"
                >
                  <span className="font-mono text-sm">{formatIsbn(extra.isbn)}</span>
                  <span className="font-semibold text-amber-600">×{extra.counted}</span>
                </div>
              ))}
            </Card>
          </section>
        ) : null}

        <AnomalySection
          title="Reliquats annoncés au bon"
          note="Écart entre la quantité commandée et celle que le fournisseur déclare avoir livrée. Ce n'est pas un manque de votre côté."
          lines={backorderedLines(session)}
          detail={(line) => `${backorder(line)} en attente`}
          tone="text-slate-500"
        />

        <section>
          <SectionTitle>Export</SectionTitle>
          <Card>
            <Button tone="secondary" disabled={exporting} onClick={() => void runExport()}>
              {exporting ? "Génération…" : "⤴ Exporter le récapitulatif (PDF + CSV)"}
            </Button>
            {exported ? (
              <p className="pt-3 text-center text-sm font-medium text-emerald-700">
                Récapitulatif généré.
              </p>
            ) : null}
            {exportError ? (
              <p className="pt-3 text-center text-sm font-medium text-red-600">{exportError}</p>
            ) : null}
            <p className="pt-3 text-xs text-slate-500">
              Les données de ce carton — bon de commande, photos et comptage — sont effacées de
              l&apos;appareil à la clôture. Exportez maintenant si vous voulez en garder une trace.
            </p>
          </Card>
        </section>
      </div>

      <ActionBar>
        <Button tone={conform ? "success" : "warning"} onClick={() => setConfirming(true)}>
          Clôturer le carton
        </Button>
        <p className="pt-2 pb-1 text-center text-xs text-slate-500">
          Puis retour à l&apos;attente d&apos;un nouveau bon de commande.
        </p>
      </ActionBar>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirming(false)} />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <h2 className="text-lg font-semibold">Clôturer définitivement ?</h2>
            <p className="mt-2 text-sm text-slate-600">
              {conform ? "Aucun écart constaté." : describeAnomalies(session)} Toutes les données de
              ce carton seront supprimées de l&apos;appareil.
              {exported ? "" : " Vous n'avez pas encore exporté le récapitulatif."}
            </p>
            <div className="mt-5 space-y-2">
              <Button tone="danger" onClick={() => void closeCarton()}>
                Clôturer et effacer
              </Button>
              <Button tone="secondary" onClick={() => setConfirming(false)}>
                Revenir au récapitulatif
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AnomalySection({
  title,
  note,
  lines,
  detail,
  tone,
}: {
  title: string;
  note?: string;
  lines: OrderLine[];
  detail: (line: OrderLine) => string;
  tone: string;
}) {
  if (lines.length === 0) return null;

  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{line.title}</p>
              <p className="font-mono text-xs text-slate-500">{formatIsbn(line.isbn)}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-semibold ${tone}`}>{detail(line)}</p>
              <p className="text-xs text-slate-500 tabular-nums">
                {line.counted}/{expected(line)}
              </p>
            </div>
          </div>
        ))}
        {note ? <p className="pt-3 text-xs text-slate-500">{note}</p> : null}
      </Card>
    </section>
  );
}

function describeAnomalies(session: Parameters<typeof totalMissing>[0]): string {
  const parts: string[] = [];
  if (totalMissing(session) > 0) parts.push(`${totalMissing(session)} manquant(s)`);
  if (totalSurplus(session) > 0) parts.push(`${totalSurplus(session)} en surplus`);
  if (totalDamaged(session) > 0) parts.push(`${totalDamaged(session)} abîmé(s)`);
  if (totalExtras(session) > 0) parts.push(`${totalExtras(session)} hors commande`);
  return parts.length > 0 ? `${parts.join(", ")}.` : "Aucun écart constaté.";
}
