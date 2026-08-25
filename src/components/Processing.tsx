"use client";

import { useCarton } from "@/lib/store";
import { useWakeLock } from "@/lib/useWakeLock";

export function Processing() {
  const progress = useCarton((state) => state.progress);

  /*
   * Lire un bon de plusieurs pages peut demander une minute, pendant laquelle
   * l'opérateur n'a rien à toucher — l'écran s'éteignait donc tout seul. iOS
   * suspend alors la page, et les requêtes OCR en vol tombent sans réponse :
   * l'échec remontait en « réseau indisponible » alors que la connexion
   * n'avait jamais été perdue.
   */
  useWakeLock(true);

  const pageCount = Math.max(progress?.pageCount ?? 1, 1);
  const done = Math.min(progress?.pageIndex ?? 0, pageCount);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8">
      <p className="font-mono text-[44px] leading-none font-medium tabular-nums">
        {done}
        <span className="text-faint">/{pageCount}</span>
      </p>

      <div className="mt-6 h-[3px] w-56 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-500"
          style={{ width: `${(done / pageCount) * 100}%` }}
        />
      </div>

      <p className="mt-6 text-[14px] text-muted" aria-live="polite">
        {progress?.stage ?? "Lecture en cours…"}
      </p>
    </main>
  );
}
