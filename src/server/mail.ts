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
 * L'expéditeur doit appartenir à un domaine vérifié chez Resend, sans quoi
 * l'API refuse l'envoi. La variable permet d'en changer sans redéploiement de
 * code, le temps que la vérification DNS aboutisse.
 */
function sender(): string {
  return process.env.MAIL_FROM?.trim() || `reception@frenchbookdistribution.com`;
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
    if (response.status === 401 || response.status === 403) {
      throw new MailError("Clé Resend refusée. Vérifiez RESEND_API_KEY.", 502);
    }
    if (response.status === 422) {
      throw new MailError(
        `Expéditeur refusé (${sender()}) : le domaine doit être vérifié chez Resend.`,
        502,
      );
    }
    throw new MailError(`Envoi refusé (${response.status}) : ${detail.slice(0, 160)}`, 502);
  }
}

export { RECIPIENT };
