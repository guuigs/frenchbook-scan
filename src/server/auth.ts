import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Authentification par code partagé.
 *
 * Un seul code pour l'équipe, échangé contre un cookie signé HMAC. Le cookie
 * est `httpOnly` : aucun script de la page ne peut le lire, et il ne contient
 * rien d'autre que sa date d'expiration et sa signature — il n'y a donc pas de
 * session à stocker côté serveur.
 *
 * Le but n'est pas de protéger des données sensibles (elles vivent sur
 * l'appareil de l'opérateur) mais d'empêcher qu'un inconnu tombant sur l'URL
 * ne consomme le crédit Mistral.
 */

export const SESSION_COOKIE = "fb_session";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET n'est pas configurée sur le serveur.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", authSecret()).update(payload).digest("hex");
}

/** Comparaison à temps constant, pour ne pas fuiter le code par chronométrage. */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAccessCodeValid(candidate: string): boolean {
  const expected = process.env.ACCESS_CODE?.trim();
  if (!expected) {
    throw new Error("ACCESS_CODE n'est pas configurée sur le serveur.");
  }
  return safeEqual(candidate.trim(), expected);
}

export function createSessionToken(): { value: string; maxAge: number } {
  const expiry = Date.now() + SESSION_DURATION_MS;
  const payload = String(expiry);
  return {
    value: `${payload}.${sign(payload)}`,
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}

function isTokenValid(token: string | undefined): boolean {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!safeEqual(signature, sign(payload))) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export async function isAuthorized(): Promise<boolean> {
  const store = await cookies();
  return isTokenValid(store.get(SESSION_COOKIE)?.value);
}
