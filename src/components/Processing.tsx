"use client";

import { useCarton } from "@/lib/store";

/**
 * Attente pendant la lecture des pages.
 *
 * La double lecture prend quelques secondes par page : on montre exactement où
 * on en est plutôt qu'un indicateur générique, pour que l'opérateur sache s'il
 * a le temps de préparer le carton.
 */
export function Processing() {
  const progress = useCarton((state) => state.progress);

  const pageCount = Math.max(progress?.pageCount ?? 1, 1);
  const done = Math.min(progress?.pageIndex ?? 0, pageCount);
  const fraction = done / pageCount;

  const radius = 70;
  const circumference = 2 * Math.PI * radius;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="#2563eb"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tabular-nums">{done}</span>
          <span className="text-sm text-slate-500">sur {pageCount}</span>
        </div>
      </div>

      <p className="mt-8 text-center text-lg font-semibold">
        {progress?.stage ?? "Lecture en cours…"}
      </p>
      <p className="mt-2 max-w-xs text-center text-sm text-slate-500">
        Chaque page est lue par deux moteurs indépendants, puis les résultats sont comparés.
      </p>
    </main>
  );
}
