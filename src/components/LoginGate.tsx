"use client";

import { useState } from "react";

import { Button } from "./ui";

/**
 * Porte d'entrée par code partagé.
 *
 * Ce n'est pas une authentification nominative : le but est d'empêcher qu'un
 * inconnu tombant sur l'URL ne consomme le crédit Mistral. Une fois le code
 * validé, l'appareil reçoit un cookie signé valable un mois.
 */
export function LoginGate({ onAuthorized }: { onAuthorized: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Connexion impossible.");
        return;
      }
      onAuthorized();
    } catch {
      setError("Réseau indisponible. Vérifiez la connexion de l'appareil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-3xl">
            📦
          </div>
          <h1 className="text-2xl font-bold">Réception</h1>
          <p className="mt-2 text-sm text-slate-500">
            Contrôle des cartons de livres. Saisissez le code d&apos;accès de l&apos;équipe.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <input
            type="password"
            inputMode="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Code d'accès"
            className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-center text-lg tracking-widest shadow-sm outline-none focus:border-blue-500"
          />

          {error ? (
            <p role="alert" className="text-center text-sm font-medium text-red-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy || !code.trim()}>
            {busy ? "Vérification…" : "Entrer"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Ajoutez cette page à l&apos;écran d&apos;accueil pour l&apos;utiliser en plein écran.
        </p>
      </div>
    </main>
  );
}
