import "server-only";

/**
 * Envoi du fichier d'import par courriel, via l'API HTTP de Resend.
 *
 * Le destinataire est écrit ici, en dur : la route ne le lit jamais de la
 * requête. Un point d'envoi qui accepterait une adresse depuis le navigateur
 * serait un relais ouvert derrière un simple code partagé — de quoi expédier
 * n'importe quoi à n'importe qui sous l'identité du domaine.
 */

const RECIPIENT = "info@frenchbookdistribution.com";

/**
 * L'expéditeur, sans valeur par défaut.
 *
 * Resend n'accepte que des adresses d'un domaine vérifié dans le compte qui
 * envoie — ici un compte personnel, dont le domaine n'a rien à voir avec celui
 * du destinataire. Deviner cette adresse ferait échouer chaque envoi sur un
 * refus de l'API, sans dire lequel des deux réglages manque.
 */
function sender(): string {
  const from = process.env.MAIL_FROM?.trim();
  if (!from) {
    throw new MailError(
      "MAIL_FROM n’est pas configurée : indiquez l’adresse d’expéditeur vérifiée chez Resend.",
      501,
    );
  }
  return from;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailError";
  }
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new MailError("L’envoi par mail n’est pas configuré sur le serveur.", 501);
  }
  return key;
}

export interface CsvMail {
  /** Numéro de commande, déjà nettoyé, tel qu'il paraîtra dans l'objet. */
  reference: string;
  filename: string;
  csv: string;
}

export async function sendCsv({ reference, filename, csv }: CsvMail): Promise<void> {
  const subject = `csv commande n°${reference}`;
  const lineCount = csv.split(/\r?\n/).filter(Boolean).length;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender(),
      to: [RECIPIENT],
      subject,
      text: [
        `Liste d'import du carton ${reference}.`,
        ``,
        `${lineCount} ligne${lineCount > 1 ? "s" : ""} — code ISBN puis quantité.`,
        `Fichier joint : ${filename}`,
      ].join("\n"),
      attachments: [{ filename, content: Buffer.from(csv, "utf8").toString("base64") }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new MailError("Clé Resend refusée. Vérifiez RESEND_API_KEY.", 502);
    }
    if (response.status === 403 || response.status === 422) {
      throw new MailError(
        `Expéditeur refusé (${sender()}) : cette adresse doit appartenir à un domaine vérifié dans votre compte Resend.`,
        502,
      );
    }
    throw new MailError(`Envoi refusé (${response.status}) : ${detail.slice(0, 160)}`, 502);
  }
}

/**
 * Compte rendu d'un dépôt reçu par courriel.
 *
 * Envoyé **dans tous les cas**, réussite comprise, et c'est délibéré. Deux
 * raisons, dont la seconde est la vraie :
 *
 * — sans accusé, l'absence de message est ambiguë : le dépôt a-t-il abouti, ou
 *   le courriel s'est-il perdu en route ? Le silence ne peut pas vouloir dire
 *   deux choses opposées.
 *
 * — Resend ne rapporte ni SPF ni DKIM dans son événement : l'adresse d'origine
 *   est déclarative, donc falsifiable. La liste blanche arrête un curieux, pas
 *   quelqu'un qui vise. Ce compte rendu est ce qui rend un dépôt illégitime
 *   visible dans la minute, et `delete_order_lines` ce qui l'annule.
 */
export async function sendImportReport(subject: string, lines: readonly string[]): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender(),
      to: [RECIPIENT],
      subject,
      text: lines.join("\n"),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new MailError(`Compte rendu non envoyé (${response.status}).`, 502);
  }
}

export { RECIPIENT };
