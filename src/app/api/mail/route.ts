import { NextResponse } from "next/server";

import { isAuthorized } from "@/server/auth";
import { MailError, sendCsv } from "@/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Le fichier d'import : des lignes « 13 chiffres ; entier », et rien d'autre. */
const IMPORT_LINE = /^\d{13};\d+$/;

/** Un carton de mille titres pèse une vingtaine de kilooctets. */
const MAX_CSV_BYTES = 256 * 1024;

export async function POST(request: Request) {
  if (!(await isAuthorized().catch(() => false))) {
    return NextResponse.json({ error: "Session expirée. Ressaisissez le code." }, { status: 401 });
  }

  let csv: string;
  let reference: string;
  try {
    const body = (await request.json()) as { csv?: unknown; reference?: unknown };
    if (typeof body.csv !== "string" || typeof body.reference !== "string") {
      throw new Error("champs manquants");
    }
    csv = body.csv;
    reference = body.reference;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux." }, { status: 413 });
  }

  /*
   * Le contenu est vérifié avant d'être expédié, et pas seulement pour attraper
   * un export malformé : la route envoie vers une adresse fixe de l'entreprise
   * derrière un code partagé par toute l'équipe. Restreindre le corps du mail à
   * la forme exacte du fichier d'import lui interdit de servir à autre chose.
   */
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à envoyer." }, { status: 400 });
  }
  if (!lines.every((line) => IMPORT_LINE.test(line))) {
    return NextResponse.json({ error: "Le fichier n’a pas la forme attendue." }, { status: 400 });
  }

  // L'objet du mail est composé côté serveur : la référence n'y entre que
  // nettoyée, et sur une seule ligne.
  const clean = reference.replace(/[\r\n]+/g, " ").trim().slice(0, 40) || "sans référence";

  try {
    await sendCsv({
      reference: clean,
      filename: `commande_${clean.replace(/[^A-Za-z0-9_-]/g, "-")}.csv`,
      csv,
    });
    return NextResponse.json({ sent: true, lines: lines.length });
  } catch (error) {
    if (error instanceof MailError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 502 });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Le service d’envoi n’a pas répondu." }, { status: 504 });
    }
    return NextResponse.json({ error: "L’envoi a échoué." }, { status: 502 });
  }
}
