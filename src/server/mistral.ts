import "server-only";

import { EXTRACTION_SCHEMA } from "@/lib/extraction-schema";
import type { ExtractedLine, ExtractedNotDelivered, ExtractedPage } from "@/lib/types";

/**
 * Accès à l'API Mistral. Ce module ne tourne que côté serveur : la clé vit
 * dans une variable d'environnement Vercel et n'atteint jamais le navigateur.
 *
 * Un seul moteur : l'endpoint OCR documentaire, à qui le schéma JSON strict
 * impose la forme de la réponse. Un modèle vision a longtemps fourni une
 * seconde lecture à confronter ; l'OCR s'étant montré fiable sur ces
 * bordereaux, le second appel ne payait plus son temps d'attente.
 */

const BASE_URL = "https://api.mistral.ai/v1";

export class MistralError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MistralError";
  }
}

function apiKey(): string {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) {
    throw new MistralError("MISTRAL_API_KEY n'est pas configurée sur le serveur.");
  }
  return key;
}

function ocrModel(): string {
  return process.env.MISTRAL_OCR_MODEL?.trim() || "mistral-ocr-latest";
}

const jsonSchema = {
  type: "json_schema",
  json_schema: {
    name: "purchase_order_page",
    schema: EXTRACTION_SCHEMA,
    strict: true,
  },
};

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    // Une page dense peut demander une trentaine de secondes ; au-delà, mieux
    // vaut rendre la main que laisser l'opérateur devant un écran figé.
    signal: AbortSignal.timeout(55_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new MistralError("Clé API Mistral refusée (401).", 401);
    }
    if (response.status === 429) {
      throw new MistralError("Trop de requêtes vers Mistral (429).", 429);
    }
    throw new MistralError(
      `Erreur Mistral ${response.status} : ${detail.slice(0, 200)}`,
      response.status,
    );
  }

  return response.json();
}

// MARK: - Lecture tolérante des sorties de modèle

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(Math.trunc(value));
  return "";
}

function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const digits = value.replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }
  return 0;
}

function toExtractedLine(raw: unknown): ExtractedLine {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    reference: asString(record.reference),
    isbn: asString(record.isbn),
    title: asString(record.title),
    publisher: asString(record.publisher),
    quantityOrdered: asInt(record.quantity_ordered),
    quantityDelivered: asInt(record.quantity_delivered),
  };
}

function toNotDelivered(raw: unknown): ExtractedNotDelivered {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    isbn: asString(record.isbn),
    title: asString(record.title),
    publisher: asString(record.publisher),
    quantity: asInt(record.quantity),
    reason: asString(record.reason),
  };
}

function toExtractedPage(raw: unknown): ExtractedPage {
  const record = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(record.lines) ? record.lines : [];
  const notDelivered = Array.isArray(record.not_delivered) ? record.not_delivered : [];
  return {
    supplier: asString(record.supplier),
    reference: asString(record.reference),
    lines: lines.map(toExtractedLine),
    notDelivered: notDelivered.map(toNotDelivered),
    declaredTotalQuantity: asInt(record.declared_total_quantity),
    declaredTotalArticles: asInt(record.declared_total_articles),
  };
}

/** Certains modèles encadrent leur JSON de balises markdown. */
function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new MistralError(`Réponse illisible du moteur : ${text.slice(0, 160)}`);
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

// MARK: - Lecture d'une page

export async function extractWithOcrEngine(dataUrl: string): Promise<ExtractedPage> {
  const result = (await post("ocr", {
    model: ocrModel(),
    document: { type: "image_url", image_url: dataUrl },
    include_image_base64: false,
    document_annotation_format: jsonSchema,
  })) as Record<string, unknown>;

  const annotation = result.document_annotation;

  // L'annotation revient sous forme de chaîne JSON à décoder une seconde fois,
  // ou déjà désérialisée selon les versions de l'API.
  if (typeof annotation === "string") {
    return toExtractedPage(parseLooseJson(annotation));
  }
  if (annotation && typeof annotation === "object") {
    return toExtractedPage(annotation);
  }

  throw new MistralError("Annotation absente de la réponse OCR.");
}
