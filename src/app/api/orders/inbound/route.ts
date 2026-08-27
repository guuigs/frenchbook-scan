import { NextResponse } from "next/server";
import { Resend } from "resend";

import { traiterRecu } from "@/server/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "cdg1";

/**
 * Réception d'une commande déposée par courriel.
 *
 * Seule route de l'application qui ne soit pas derrière le cookie de session :
 * l'appelant est Resend, pas un navigateur. Ce qui tient sa place est la
 * signature Svix du corps — sans elle, l'adresse de cette route suffirait à
 * écrire dans le référentiel.
 *
 * Elle rend 200 sur presque tout, y compris sur un dépôt refusé : un refus est
 * un traitement abouti, dont le motif part par courriel. Un code d'erreur ferait
 * rejouer le message par Resend, ce qui ne changerait rien au motif du refus et
 * multiplierait les comptes rendus.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET n’est pas configurée." },
      { status: 501 },
    );
  }

  const corps = await request.text();

  let evenement;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY?.trim());
    evenement = resend.webhooks.verify({
      payload: corps,
      // Le SDK attend les trois valeurs Svix déjà extraites, sous des noms
      // courts — et non l'objet `Headers` de la requête, contrairement à ce
      // que montre la documentation.
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    // Signature absente ou fausse : on ne dit pas pourquoi, et on ne traite rien.
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  // Resend envoie d'autres événements sur le même point d'entrée si on l'y
  // abonne : on les acquitte sans rien faire.
  if (evenement.type !== "email.received" || !evenement.data.email_id) {
    return NextResponse.json({ ignored: true });
  }

  const { email_id: emailId, from, subject } = evenement.data;

  try {
    await traiterRecu({ emailId, from: from ?? "", subject: subject ?? "" });
  } catch {
    /*
     * `traiterRecu` rend déjà compte de tout ce qui tourne mal. Ce filet ne
     * couvre que ce qui l'empêcherait lui-même d'aboutir — l'envoi du compte
     * rendu, typiquement. Un 500 ferait rejouer le message par Resend : c'est
     * la seule situation où le rejeu a une chance de servir.
     */
    return NextResponse.json({ error: "Traitement impossible." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
