import "server-only";

import { Resend } from "resend";

import {
  CORRESPONDANCE_FIGEE,
  construire,
  lireCsvBrut,
  refusEntete,
  referenceDepuisNom,
  type Feuille,
} from "@/lib/import-format";
import { countOrderLines, importOrderLines } from "./orders";
import { sendImportReport } from "./mail";

/**
 * Dépôt d'une commande arrivée par courriel.
 *
 * Le chemin est le même que celui de l'écran — même lecture, même mise en
 * forme, même fonction SQL — à une différence près qui commande tout le reste :
 * **personne ne relit avant que ça n'entre en base.**
 *
 * D'où trois règles qui n'ont pas cours à l'écran :
 *
 * — l'en-tête est exigé au caractère près, jamais deviné. Une colonne
 *   rattachée de travers passerait ici sans témoin.
 * — l'expéditeur doit figurer dans la liste blanche.
 * — un compte rendu part dans tous les cas, y compris en cas de réussite.
 */

/**
 * La seule adresse autorisée à déposer.
 *
 * Écrite ici plutôt qu'en variable d'environnement, comme le destinataire de
 * `mail.ts` : ce qui donne accès en écriture au référentiel se lit dans le
 * code, pas dans un réglage qu'on peut élargir par inadvertance.
 *
 * Elle n'authentifie personne — Resend ne rapporte ni SPF ni DKIM, donc une
 * adresse d'origine reste déclarative. C'est une barrière contre l'erreur et le
 * courrier de passage, pas contre quelqu'un qui vise ; ce qui protège vraiment
 * est le compte rendu systématique, et la possibilité de défaire.
 */
const EXPEDITEURS_AUTORISES = ["info@frenchbookdistribution.com"];

/** Au-delà, ce n'est pas une commande — et le tableur tiendrait la mémoire. */
const TAILLE_MAX = 10 * 1024 * 1024;

export class InboundError extends Error {}

function client(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InboundError("RESEND_API_KEY n’est pas configurée.");
  return new Resend(key);
}

/** L'adresse seule, sans le « Nom Prénom <…> » qui l'entoure souvent. */
function adresse(brut: string): string {
  const entre = /<([^>]+)>/.exec(brut);
  return (entre ? entre[1] : brut).trim().toLowerCase();
}

export function expediteurAutorise(from: string): boolean {
  return EXPEDITEURS_AUTORISES.includes(adresse(from));
}

/**
 * Le premier fichier qui ressemble à une commande.
 *
 * Un message porte souvent une signature en image, voire le bon en PDF : on ne
 * prend pas « la première pièce jointe » mais la première qui puisse être une
 * commande.
 */
function piecePertinente<T extends { filename?: string; download_url: string }>(
  pieces: readonly T[],
): T | null {
  return pieces.find((piece) => /\.(xlsx|xls|csv)$/i.test((piece.filename ?? "").trim())) ?? null;
}

async function lirePiece(nom: string, contenu: Buffer): Promise<Feuille> {
  if (/\.csv$/i.test(nom)) return lireCsvBrut(contenu.toString("utf8"));

  // Volet serveur du lecteur de tableur : la même bibliothèque que le
  // navigateur, par son entrée Node.
  const { readSheet } = await import("read-excel-file/node");
  const rangees = await readSheet(contenu);
  const enTexte = rangees.map((rangee) =>
    rangee.map((brut) => {
      const cellule: unknown = brut;
      if (cellule instanceof Date) return cellule.toISOString().slice(0, 10);
      return cellule === null || cellule === undefined ? "" : String(cellule).trim();
    }),
  );
  if (enTexte.length === 0) return { entete: [], lignes: [] };
  const [entete, ...reste] = enTexte;
  return { entete, lignes: reste };
}

export interface Recu {
  emailId: string;
  from: string;
  subject: string;
}

/**
 * Traite un courriel reçu, et rend compte par courriel dans tous les cas.
 *
 * Ne lève jamais : un webhook qui échoue serait rejoué par Resend, et un
 * rejeu ne ferait que buter sur le refus de doublon. Tout ce qui tourne mal
 * est dit à l'expéditeur, ce qui est le seul retour utile ici.
 */
export async function traiterRecu({ emailId, from, subject }: Recu): Promise<void> {
  const rendreCompte = async (objet: string, lignes: string[]) => {
    await sendImportReport(objet, [...lignes, "", `Message reçu de ${adresse(from)}.`]);
  };

  if (!expediteurAutorise(from)) {
    // Rien n'est renvoyé à l'expéditeur : il n'est pas connu, et lui répondre
    // ferait de la boîte un amplificateur. Le compte rendu part à l'adresse
    // fixe, qui est la seule à devoir le savoir.
    await rendreCompte("Dépôt refusé — expéditeur inconnu", [
      "Un courriel a été déposé depuis une adresse non autorisée. Rien n’a été importé.",
    ]);
    return;
  }

  const resend = client();

  // La réponse enveloppe la liste : `data.data` porte les pièces elles-mêmes.
  const { data: enveloppe, error } = await resend.emails.receiving.attachments.list({ emailId });
  if (error || !enveloppe) {
    await rendreCompte("Dépôt échoué — pièce jointe illisible", [
      "La pièce jointe n’a pas pu être récupérée auprès de Resend. Rien n’a été importé.",
    ]);
    return;
  }

  const piece = piecePertinente(enveloppe.data);
  if (!piece?.download_url) {
    await rendreCompte("Dépôt échoué — aucun fichier de commande", [
      "Le message ne portait aucun fichier .xlsx, .xls ou .csv. Rien n’a été importé.",
    ]);
    return;
  }

  const nom = (piece.filename ?? "commande.xlsx").trim();

  const reponse = await fetch(piece.download_url, { signal: AbortSignal.timeout(30_000) });
  if (!reponse.ok) {
    await rendreCompte("Dépôt échoué — téléchargement impossible", [
      `Le fichier « ${nom} » n’a pas pu être téléchargé. Rien n’a été importé.`,
    ]);
    return;
  }

  const contenu = Buffer.from(await reponse.arrayBuffer());
  if (contenu.byteLength > TAILLE_MAX) {
    await rendreCompte("Dépôt refusé — fichier trop volumineux", [
      `« ${nom} » pèse ${Math.round(contenu.byteLength / 1024 / 1024)} Mo. Rien n’a été importé.`,
    ]);
    return;
  }

  let feuille: Feuille;
  try {
    feuille = await lirePiece(nom, contenu);
  } catch {
    await rendreCompte("Dépôt échoué — fichier illisible", [
      `« ${nom} » n’a pas pu être ouvert. Rien n’a été importé.`,
    ]);
    return;
  }

  /*
   * Le refus le plus fréquent, et celui qui justifie l'en-tête figé : le même
   * logiciel produit un export sans la colonne « Code », donc sans ISBN. À
   * l'écran on le voit ; ici, il faut le dire.
   */
  const refus = refusEntete(feuille.entete);
  if (refus) {
    await rendreCompte("Dépôt refusé — format inattendu", [
      `« ${nom} » ne porte pas l’en-tête attendu de l’export « special order ».`,
      `Motif : ${refus}.`,
      "",
      "Rien n’a été importé. Réexportez la commande en incluant la colonne « Code »,",
      "puis renvoyez le fichier.",
    ]);
    return;
  }

  const { lignes, ecartees, doublons } = construire(feuille, CORRESPONDANCE_FIGEE);
  if (lignes.length === 0) {
    await rendreCompte("Dépôt refusé — aucune ligne exploitable", [
      `« ${nom} » ne porte aucune ligne avec un ISBN à treize chiffres. Rien n’a été importé.`,
    ]);
    return;
  }

  // Le nom du fichier identifie la commande, comme pour les 71 références déjà
  // en base ; l'objet du message porte le nom lisible que verra l'opérateur.
  const reference = referenceDepuisNom(nom);
  const customer = subject.trim() || reference;

  const existantes = await countOrderLines(reference);
  if (existantes > 0) {
    await rendreCompte("Dépôt refusé — commande déjà présente", [
      `La commande « ${reference} » existe déjà (${existantes} ligne${
        existantes > 1 ? "s" : ""
      }). Rien n’a été importé.`,
      "",
      "Renommez le fichier, ou supprimez d’abord la commande existante.",
    ]);
    return;
  }

  let inserees: number;
  try {
    inserees = await importOrderLines(reference, customer, lignes);
  } catch (cause) {
    await rendreCompte("Dépôt échoué — import refusé", [
      cause instanceof Error ? cause.message : "L’import a échoué.",
      "Rien n’a été importé.",
    ]);
    return;
  }

  await rendreCompte(`Commande importée — ${reference}`, [
    `${inserees} ligne${inserees > 1 ? "s" : ""} importée${inserees > 1 ? "s" : ""}.`,
    "",
    `Référence : ${reference}`,
    `Nom affiché au scan : ${customer}`,
    `Fichier : ${nom}`,
    ecartees > 0 ? `${ecartees} ligne(s) sans ISBN valide écartée(s).` : "",
    doublons > 0 ? `${doublons} doublon(s) interne(s) fusionné(s).` : "",
  ].filter(Boolean));
}
