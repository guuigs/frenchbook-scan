import type { CartonSession } from "./types";
import { formatIsbn } from "./isbn";
import {
  backorder,
  expected,
  missingLines,
  shortfall,
  surplus,
  surplusLines,
  totalCounted,
  totalDamaged,
  totalExpected,
  totalExtras,
} from "./order";

/**
 * Récapitulatif de réception, généré avant la purge du cache.
 *
 * Deux formats : un PDF lisible tel quel, à joindre à un litige fournisseur, et
 * un CSV réintégrable dans un tableur ou un ERP.
 */

function fileStem(session: CartonSession): string {
  const stamp = new Date(session.startedAt)
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(":", "");
  const reference = session.reference.trim() || "carton";
  return `reception_${reference.replace(/[^A-Za-z0-9_-]/g, "-")}_${stamp}`;
}

function escapeCsv(value: string): string {
  return value.replace(/;/g, ",").replace(/[\r\n]+/g, " ");
}

export function buildCsv(session: CartonSession): Blob {
  const rows = [
    "ISBN;Titre;Auteur;Qte commandee;Qte annoncee livree;Qte comptee;Ecart;Abimes;Statut",
  ];

  for (const line of session.lines) {
    const status = shortfall(line) > 0 ? "MANQUE" : surplus(line) > 0 ? "SURPLUS" : "CONFORME";
    rows.push(
      [
        line.isbn,
        escapeCsv(line.title),
        escapeCsv(line.author),
        line.quantityOrdered,
        line.quantityDelivered,
        line.counted,
        line.counted - expected(line),
        line.damaged,
        status,
      ].join(";"),
    );
  }

  for (const extra of session.extras) {
    rows.push(
      [extra.isbn, "Non commande", "", 0, 0, extra.counted, `+${extra.counted}`, extra.damaged, "HORS BON"].join(
        ";",
      ),
    );
  }

  // BOM UTF-8 : sans lui, Excel en français casse les accents.
  return new Blob(["﻿", rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export async function buildPdf(session: CartonSession): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const margin = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margin;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const write = (text: string, size: number, style: "normal" | "bold" = "normal", color = "#000000") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(text, margin, y);
    y += size + 4;
  };

  write("Bon de réception", 18, "bold");
  y += 6;

  write(`Fournisseur : ${session.supplier || "—"}`, 10);
  write(`Référence : ${session.reference || "—"}`, 10);
  write(
    `Réceptionné le ${new Date().toLocaleString("fr-FR")} — ${session.pageCount} page(s) de bon`,
    9,
    "normal",
    "#555555",
  );
  y += 12;

  write("Synthèse", 12, "bold");
  const summary = [
    `Titres au bon : ${session.lines.length}`,
    `Exemplaires attendus : ${totalExpected(session)}`,
    `Exemplaires comptés : ${totalCounted(session)}`,
    `Manquants : ${missingLines(session).reduce((sum, line) => sum + shortfall(line), 0)}`,
    `En surplus : ${surplusLines(session).reduce((sum, line) => sum + surplus(line), 0)}`,
    `Abîmés : ${totalDamaged(session)}`,
    `Hors bon de commande : ${totalExtras(session)}`,
  ];
  for (const item of summary) {
    write(`• ${item}`, 10);
  }
  y += 12;

  write("Détail des lignes", 12, "bold");

  const columns = [margin, margin + 100, margin + 330, margin + 385, margin + 440, margin + 495];
  const row = (
    cells: [string, string, string, string, string, string],
    style: "normal" | "bold",
    color: string,
  ) => {
    doc.setFont("courier", style);
    doc.setFontSize(8);
    doc.setTextColor(color);
    cells.forEach((cell, index) => doc.text(cell, columns[index], y));
    y += 12;
  };

  row(["ISBN", "Titre", "Cde", "Livr", "Cpte", "Abime"], "bold", "#555555");

  for (const line of session.lines) {
    newPageIfNeeded(16);
    const title = line.title.length > 40 ? `${line.title.slice(0, 39)}…` : line.title;
    const color =
      shortfall(line) > 0 ? "#c0392b" : surplus(line) > 0 || line.damaged > 0 ? "#c87f0a" : "#000000";
    row(
      [
        line.isbn,
        title,
        String(line.quantityOrdered),
        String(line.quantityDelivered),
        String(line.counted),
        String(line.damaged),
      ],
      "normal",
      color,
    );
  }

  if (session.extras.length > 0) {
    y += 12;
    newPageIfNeeded(40);
    write("Livres hors bon de commande", 12, "bold");
    for (const extra of session.extras) {
      newPageIfNeeded(16);
      write(`${formatIsbn(extra.isbn)}  ×${extra.counted}`, 9, "normal", "#c87f0a");
    }
  }

  const backordered = session.lines.filter((line) => backorder(line) > 0);
  if (backordered.length > 0) {
    y += 12;
    newPageIfNeeded(40);
    write("Reliquats annoncés au bon", 12, "bold");
    for (const line of backordered) {
      newPageIfNeeded(16);
      write(`${formatIsbn(line.isbn)} — ${backorder(line)} en attente`, 9, "normal", "#555555");
    }
  }

  y += 18;
  newPageIfNeeded(30);
  write(
    "Document généré par Réception. Les données de ce carton ont été effacées de l'appareil après cet export.",
    8,
    "normal",
    "#888888",
  );

  return doc.output("blob");
}

export interface ExportFiles {
  pdf: File;
  csv: File;
}

export async function buildExportFiles(session: CartonSession): Promise<ExportFiles> {
  const stem = fileStem(session);
  const [pdfBlob, csvBlob] = [await buildPdf(session), buildCsv(session)];
  return {
    pdf: new File([pdfBlob], `${stem}.pdf`, { type: "application/pdf" }),
    csv: new File([csvBlob], `${stem}.csv`, { type: "text/csv" }),
  };
}

/**
 * Partage via la feuille iOS quand elle est disponible (mail, AirDrop, Fichiers,
 * Drive), sinon téléchargement classique.
 */
export async function shareOrDownload(files: ExportFiles): Promise<"shared" | "downloaded"> {
  const list = [files.pdf, files.csv];

  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title: "Bon de réception" });
      return "shared";
    } catch (error) {
      // L'opérateur a fermé la feuille de partage : ce n'est pas une erreur.
      if (error instanceof DOMException && error.name === "AbortError") {
        return "shared";
      }
    }
  }

  for (const file of list) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "downloaded";
}
