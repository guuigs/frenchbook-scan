"use client";

import { useRef, useState } from "react";

import { useCarton } from "@/lib/store";
import { makeThumbnail, prepareForUpload } from "@/lib/images";
import { ActionBar, Button, IconButton, Note } from "./ui";
import { IconBox, IconCamera, IconChevronLeft, IconClose, IconImage, IconSettings } from "./icons";

interface StagedPage {
  id: string;
  file: Blob;
  thumbnail: string;
}

export function Home({
  onOpenSettings,
  onBack,
}: {
  onOpenSettings: () => void;
  onBack?: () => void;
}) {
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
      setError("Cette image n’a pas pu être lue. Reprenez la photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-4">
        <span className="flex items-center gap-2">
          {onBack ? (
            <IconButton label="Retour" onClick={onBack}>
              <IconChevronLeft />
            </IconButton>
          ) : null}
          <h1 className="text-[22px] font-semibold">Réception</h1>
        </span>
        <IconButton label="Réglages" onClick={onOpenSettings}>
          <IconSettings />
        </IconButton>
      </header>

      {/* Sur un écran vide, le contenu se centre plutôt que de flotter en haut
          d'une page aux trois quarts vide. */}
      <div
        className={`flex flex-1 flex-col gap-3 px-4 pb-6 ${
          pages.length === 0 ? "justify-center" : ""
        }`}
      >
        {error ? (
          <Note tone="danger" aria-live="polite">
            {error}
          </Note>
        ) : null}

        {pages.length === 0 ? (
          <div className="flex flex-col items-center rounded-[10px] border border-dashed border-border-strong px-6 py-12 text-center">
            <IconBox className="h-6 w-6 text-faint" />
            <p className="mt-3 text-[15px] font-medium">Aucun carton en cours</p>
            <p className="mt-1 text-[13px] text-muted">Photographiez le bon de commande.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {pages.map((page, index) => (
              <li key={page.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.thumbnail}
                  alt={`Page ${index + 1}`}
                  width={180}
                  height={240}
                  className="aspect-3/4 w-full rounded-[8px] border border-border bg-subtle object-cover"
                />
                <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setPages((current) => current.filter((p) => p.id !== page.id))}
                  aria-label={`Retirer la page ${index + 1}`}
                  className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-panel text-muted hover:text-foreground active:bg-subtle"
                >
                  <IconClose className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => cameraInput.current?.click()} disabled={busy}>
            <IconCamera />
            {pages.length === 0 ? "Photographier" : "Ajouter"}
          </Button>
          <Button variant="secondary" onClick={() => libraryInput.current?.click()} disabled={busy}>
            <IconImage />
            Importer
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
      </div>

      {pages.length > 0 ? (
        <ActionBar>
          <Button disabled={busy} onClick={() => void processPages(pages.map((page) => page.file))}>
            Lire {pages.length} page{pages.length > 1 ? "s" : ""}
          </Button>
          <div className="h-3" />
        </ActionBar>
      ) : null}
    </main>
  );
}
