import { NextResponse } from "next/server";

import { SESSION_COOKIE, createSessionToken, isAccessCodeValid, isAuthorized } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Le client interroge cette route au démarrage pour savoir s'il doit demander le code. */
export async function GET() {
  try {
    return NextResponse.json({ authorized: await isAuthorized() });
  } catch {
    return NextResponse.json({ authorized: false, misconfigured: true });
  }
}

export async function POST(request: Request) {
  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  if (!code.trim()) {
    return NextResponse.json({ error: "Code manquant." }, { status: 400 });
  }

  let valid: boolean;
  try {
    valid = isAccessCodeValid(code);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Serveur mal configuré." },
      { status: 500 },
    );
  }

  if (!valid) {
    // Petit délai constant : décourage le balayage automatisé sans gêner
    // l'opérateur qui se trompe de touche.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "Code incorrect." }, { status: 401 });
  }

  const token = createSessionToken();
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(SESSION_COOKIE, token.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: token.maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
