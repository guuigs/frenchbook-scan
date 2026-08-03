"use client";

import { useRef, useState } from "react";

import { useCarton } from "@/lib/store";
import { makeThumbnail, prepareForUpload } from "@/lib/images";
import { ActionBar, Banner, Button, Card, SectionTitle } from "./ui";

interface StagedPage {
  id: string;
  file: Blob;
  thumbnail: string;
}

const STEPS: Array<[string, string, string]> = [
  ["1", "Photographier le bon", "Une page après l'autre, dans l'ordre du document."],
  ["2", "Contrôler la lecture", "Seules les lignes douteuses vous sont soumises."],
  ["3", "Scanner les livres", "La caméra reste active, les scans s'enchaînent."],
  ["4", "Clôturer le carton", "Récapitulatif des écarts, export, puis effacement."],
];

/**
 * Écran d'attente et constitution du bon de commande.
 *
 * Safari n'offre pas de scanner multipage : on assemble donc les pages une à
 * une dans une zone de préparation, ce qui permet en prime de revoir l'ordre
 * et de reprendre une photo ratée avant de lancer la lecture.
 */
export function Home({ onOpenSettings }: { onOpenSettings: () => void }) {
  const processPages = useCarton((state) => state.processPages);
  const error = useCarton((state) => state.error);
  const setError = useCarton((state) => state.setError);

  const [pages, setPages] = useState<StagedPage[]>([]);
  const [busy, setBusy] = useState(false);

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const added: StagedPage[] = [];
      for (const file of Array.from(files)) {
        const prepared = await prepareForUpload(file);
        added.push({
          id: crypto.randomUUID(),
          file: await (await fetch(prepared)).blob(),
          thumbnail: await makeThumbnail(prepared),
        });
      }
      setPages((current) => [...current, ...added]);
    } catch {
      setError("Cette image n'a pas pu être lue. Reprenez la photo.");
    } finally {
      setBusy(false);
    }
  };

  const removePage = (id: string) => setPages((current) => current.filter((page) => page.id !== id));

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-5 pb-2">
        <h1 className="text-3xl font-bold">Réception</h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Réglages"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm"
        >
          ⚙︎
        </button>
      </header>

      <div className="flex-1 space-y-5 px-4 pb-6">
        {error ? (
          <Banner tone="danger" title="Lecture impossible">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-2 font-semibold underline"
            >
              Masquer
            </button>
          </Banner>
        ) : null}

        {pages.length === 0 ? (
          <Card className="text-center">
            <div className="py-4 text-5xl">📦</div>
            <p className="text-lg font-semibold">Aucun carton en cours</p>
            <p className="mt-1 text-sm text-slate-500">
              Commencez par photographier le bon de commande papier trouvé dans le carton.
            </p>
          </Card>
        ) : (
          <section>
            <SectionTitle
              action={
                <button
                  type="button"
                  onClick={() => setPages([])}
                  className="text-sm font-semibold text-red-600"
                >
                  Tout retirer
                </button>
              }
            >
              {pages.length} page{pages.length > 1 ? "s" : ""} prête
              {pages.length > 1 ? "s" : ""}
            </SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              {pages.map((page, index) => (
                <div key={page.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.thumbnail}
                    alt={`Page ${index + 1}`}
                    className="aspect-3/4 w-full rounded-xl border border-slate-200 bg-white object-cover"
                  />
                  <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePage(page.id)}
                    aria-label={`Retirer la page ${index + 1}`}
                    className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white shadow"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="space-y-2">
          <Button tone="secondary" onClick={() => cameraInput.current?.click()} disabled={busy}>
            📷 {pages.length === 0 ? "Photographier une page" : "Ajouter une page"}
          </Button>
          <Button tone="secondary" onClick={() => libraryInput.current?.click()} disabled={busy}>
            🖼️ Importer depuis la photothèque
          </Button>
        </div>

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={libraryInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <section>
          <SectionTitle>Déroulé</SectionTitle>
          <Card className="space-y-3">
            {STEPS.map(([number, title, detail]) => (
              <div key={number} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
                  {number}
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-slate-500">{detail}</p>
                </div>
              </div>
            ))}
          </Card>
        </section>
      </div>

      {pages.length > 0 ? (
        <ActionBar>
          <Button
            disabled={busy}
            onClick={() => void processPages(pages.map((page) => page.file))}
          >
            Lire {pages.length} page{pages.length > 1 ? "s" : ""}
          </Button>
          <p className="pt-2 pb-1 text-center text-xs text-slate-500">
            Chaque page est lue par deux moteurs indépendants, puis comparée.
          </p>
        </ActionBar>
      ) : null}
    </main>
  );
}
