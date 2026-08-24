import type { CartonSession } from "./types";
import { formatIsbn, normalizeIsbn } from "./isbn";
import {
  allocationsByOrder,
  backorder,
  missingLines,
  shortfall,
  surplus,
  surplusLines,
  totalCounted,
  totalDamaged,
  totalExpected,
  totalExtras,
  unallocatedTotal,
  allocatedTotal,
} from "./order";

/**
 * Sorties de fin de carton, générées avant la purge du cache.
 *
 * Deux fichiers, deux usages qui n'ont rien à voir :
 *
 * — le PDF est la trace de la réception, à joindre à une réclamation
 *   fournisseur. Il porte tout : manques, surplus, abîmés, non servis,
 *   reliquats.
 *
 * — le CSV est une liste d'import pour Librisoft, et rien d'autre. Il ne porte
 *   que ce qui est bon dans le carton. Un fichier d'import n'est pas un
 *   rapport : la moindre ligne parasite entre en stock comme les autres.
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

/** Une ligne prête à entrer en stock : le code, et le nombre d'exemplaires sains. */
export interface ImportRow {
  isbn: string;
  quantity: number;
}

/**
 * Ce qui est physiquement dans le carton et bon à valider.
 *
 * Le comptage moins les exemplaires signalés abîmés : ceux-là partent en
 * réclamation, ils n'entrent pas en stock. Ce qui n'a jamais été scanné ne
 * figure pas non plus — un manque n'est pas une entrée à zéro, c'est une
 * absence, et Librisoft n'a rien à en faire.
 *
 * Les articles annoncés non livrés par le fournisseur sont hors sujet par
 * construction : ils ne sont pas dans le carton.
 *
 * Restent deux cas de bord, tranchés dans le même sens — ce qui a été scanné
 * est ce qui est là :
 *
 * — le surplus, un exemplaire de plus que le bon n'en annonce, entre en stock
 *   avec les autres. Il est dans le carton, l'opérateur l'a eu en main. C'est
 *   le litige fournisseur qui se règle au PDF, pas l'état du stock.
 *
 * — le livre hors bon, scanné sans figurer nulle part sur le bordereau,
 *   n'entre PAS. Son ISBN n'a été confronté à aucune ligne écrite : le
 *   rapprochement reste à faire, et un import est difficile à défaire.
 */
export function importRows(session: CartonSession): ImportRow[] {
  const rows: ImportRow[] = [];

  for (const line of session.lines) {
    const isbn = normalizeIsbn(line.isbn);
    // Un code mal formé ferait échouer la ligne à l'import, ou pire, entrerait
    // sous une référence qui n'existe pas.
    if (isbn.length !== 13) continue;

    const quantity = line.counted - line.damaged;
    if (quantity <= 0) continue;

    rows.push({ isbn, quantity });
  }

  return rows;
}

/**
 * Liste d'import Librisoft : le code ISBN, puis la quantité.
 *
 * La liste mémorisée de Librisoft se charge depuis un fichier texte ou CSV
 * portant « le code ISBN des articles puis la quantité » — donc deux colonnes,
 * dans cet ordre, et rien de plus. Les choix de forme visent le lecteur le plus
 * strict possible :
 *
 * — pas de ligne d'en-tête : elle serait lue comme un article, et « ISBN » ne
 *   ressemble à aucun code ;
 * — point-virgule, séparateur des CSV en locale française ;
 * — treize chiffres collés, sans tiret ni espace, tels qu'ils sont scannés ;
 * — pas de BOM UTF-8, alors que le récapitulatif en a besoin : ici le fichier
 *   n'a aucun accent, et l'octet invisible se retrouverait collé au premier
 *   chiffre du premier ISBN.
 */
export function buildCsv(session: CartonSession): Blob {
  const rows = importRows(session).map((row) => `${row.isbn};${row.quantity}`);
  const content = rows.length > 0 ? `${rows.join("\r\n")}\r\n` : "";
  return new Blob([content], { type: "text/csv;charset=utf-8" });
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
    `Affectés à une commande : ${allocatedTotal(session)}`,
    `Non affectés : ${unallocatedTotal(session)}`,
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

  /*
   * La répartition par commande est ce qui sert à préparer les colis : elle
   * vient donc juste après le détail des lignes, avant les anomalies.
   */
  const tallies = allocationsByOrder(session);
  if (tallies.length > 0) {
    y += 12;
    newPageIfNeeded(40);
    write("Répartition par commande", 12, "bold");
    for (const tally of tallies) {
      newPageIfNeeded(16);
      const who = tally.customer ? ` — ${tally.customer}` : "";
      write(
        `${tally.orderReference}${who} : ${tally.quantity} exemplaire${tally.quantity > 1 ? "s" : ""}`,
        9,
      );
      for (const entry of tally.lines) {
        newPageIfNeeded(14);
        doc.setFont("courier", "normal");
        doc.setFontSize(8);
        doc.setTextColor("#555555");
        doc.text(`    ${formatIsbn(entry.isbn)}  ×${entry.quantity}`, margin, y);
        y += 11;
      }
    }

    const loose = unallocatedTotal(session);
    if (loose > 0) {
      newPageIfNeeded(16);
      write(`Non affectés : ${loose} exemplaire${loose > 1 ? "s" : ""}`, 9);
    }
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

  if (session.notDelivered.length > 0) {
    y += 12;
    newPageIfNeeded(40);
    write("Annoncés non livrés par le fournisseur", 12, "bold");
    for (const item of session.notDelivered) {
      newPageIfNeeded(16);
      const reason = item.reason ? ` — ${item.reason}` : "";
      write(
        `${formatIsbn(item.isbn)}  ${item.title}  ×${item.quantity}${reason}`,
        9,
        "normal",
        "#555555",
      );
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
    // Le suffixe évite l'hésitation devant la feuille de partage : les deux
    // fichiers ne vont pas au même endroit.
    csv: new File([csvBlob], `${stem}_librisoft.csv`, { type: "text/csv" }),
  };
}

/** Adresse de destination, pour l'afficher : le serveur ne la lit d'aucun client. */
export const MAIL_RECIPIENT = "info@frenchbookdistribution.com";

/**
 * Envoie la liste d'import au service commercial.
 *
 * Le fichier part du serveur, pas du téléphone : `mailto:` ne sait pas joindre
 * de pièce, et la feuille de partage iOS ne sait pas pré-remplir un
 * destinataire. C'est aussi ce qui permet à l'adresse d'être écrite côté
 * serveur, hors d'atteinte du navigateur.
 */
export async function mailCsv(session: CartonSession): Promise<number> {
  const csv = await buildCsv(session).text();

  let response: Response;
  try {
    response = await fetch("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, reference: session.reference }),
    });
  } catch {
    throw new Error("Réseau indisponible. Vérifiez la connexion de l’appareil.");
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === "string"
        ? payload.error
        : `L’envoi a échoué (${response.status}).`,
    );
  }

  return typeof payload?.lines === "number" ? payload.lines : 0;
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
