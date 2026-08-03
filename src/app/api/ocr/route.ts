import { NextResponse } from "next/server";

import { isAuthorized } from "@/server/auth";
import { MistralError, extractWithOcrEngine, extractWithVisionEngine } from "@/server/mistral";
import type { ExtractedPage, OcrPageResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Une page dense peut demander plusieurs dizaines de secondes aux deux moteurs.
 * Le client envoie une page par requête, ce qui garde chaque appel sous cette
 * limite même sur un bon de trente pages.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthorized().catch(() => false))) {
    return NextResponse.json({ error: "Session expirée. Ressaisissez le code." }, { status: 401 });
  }

  let image: string;
  let doubleCheck = true;
  try {
    const body = (await request.json()) as { image?: unknown; doubleCheck?: unknown };
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      throw new Error("image manquante");
    }
    image = body.image;
    doubleCheck = body.doubleCheck !== false;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  if (!doubleCheck) {
    try {
      const engineA = await extractWithOcrEngine(image);
      return NextResponse.json({ engineA, engineB: null, degraded: true } satisfies OcrPageResponse);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const [resultA, resultB] = await Promise.allSettled([
    extractWithOcrEngine(image),
    extractWithVisionEngine(image),
  ]);

  const pageA = resultA.status === "fulfilled" ? resultA.value : null;
  const pageB = resultB.status === "fulfilled" ? resultB.value : null;

  // Si un seul moteur répond, on ne bloque pas l'opérateur : on rend la lecture
  // en la marquant dégradée, et chaque ligne portera la mention « source
  // unique » à vérifier.
  if (pageA && pageB) {
    return NextResponse.json({ engineA: pageA, engineB: pageB, degraded: false });
  }

  const survivor: ExtractedPage | null = pageA ?? pageB;
  if (survivor) {
    return NextResponse.json({ engineA: survivor, engineB: null, degraded: true });
  }

  return errorResponse(resultA.status === "rejected" ? resultA.reason : resultB);
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
