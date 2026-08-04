"use client";

import { useState } from "react";

import { Button, Input, Note } from "./ui";
import { IconBox } from "./icons";

export function LoginGate({ onAuthorized }: { onAuthorized: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
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
        setError(payload.error ?? "Connexion impossible. Réessayez.");
        return;
      }
      onAuthorized();
    } catch {
      setError("Réseau indisponible. Vérifiez la connexion de l’appareil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <IconBox className="mb-5 h-6 w-6 text-foreground" />
        <h1 className="text-[22px] font-semibold">Réception</h1>
        <p className="mt-1 mb-6 text-[14px] text-muted">Saisissez le code d’accès.</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <Input
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-label="Code d’accès"
            autoComplete="current-password"
            spellCheck={false}
            placeholder="Code d’accès…"
          />

          {error ? (
            <Note tone="danger" aria-live="polite">
              {error}
            </Note>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? "Vérification…" : "Entrer"}
          </Button>
        </form>
      </div>
    </main>
  );
}
