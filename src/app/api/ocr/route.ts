import { NextResponse } from "next/server";

import { isAuthorized } from "@/server/auth";
import { MistralError, extractWithOcrEngine } from "@/server/mistral";
import type { OcrPageResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Une page dense peut demander plusieurs dizaines de secondes au moteur. Le
 * client envoie une page par requête, ce qui garde chaque appel sous cette
 * limite même sur un bon de trente pages.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthorized().catch(() => false))) {
    return NextResponse.json({ error: "Session expirée. Ressaisissez le code." }, { status: 401 });
  }

  let image: string;
  try {
    const body = (await request.json()) as { image?: unknown };
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      throw new Error("image manquante");
    }
    image = body.image;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  try {
    const page = await extractWithOcrEngine(image);
    return NextResponse.json({ page } satisfies OcrPageResponse);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof MistralError) {
    return NextResponse.json({ error: error.message }, { status: error.status ?? 502 });
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return NextResponse.json(
      { error: "Le moteur n'a pas répondu à temps. Réessayez cette page." },
      { status: 504 },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Lecture impossible." },
    { status: 502 },
  );
}
