"use client";

import { useRef, useState } from "react";

import { ActionBar, Button, IconButton } from "./ui";
import { IconAlert, IconChevronLeft, IconClose, IconFileSpreadsheet } from "./icons";
import {
  HeaderMismatchError,
  buildOrdersCsv,
  parseClients,
  parseOrderSheet,
  type ClientsMap,
  type OrderRow,
} from "@/lib/ordersCsv";

type Entry =
  | { id: string; kind: "order"; name: string; status: "ok"; rows: OrderRow[] }
  | { id: string; kind: "order"; name: string; status: "error"; message: string }
  | { id: string; kind: "clients"; name: string; status: "ok"; count: number }
  | { id: string; kind: "clients"; name: string; status: "error"; message: string };

function isClientsFile(name: string): boolean {
  return name.toLowerCase() === "clients.csv";
}

function isOrderFile(name: string): boolean {
  return name.toLowerCase().endsWith(".xlsx");
}

async function shareOrDownloadCsv(file: File): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Commandes clients" });
      return;
    } catch (error) {
      // L'opérateur a fermé la feuille de partage : ce n'est pas une erreur.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ClientOrders({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [clients, setClients] = useState<ClientsMap>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const id = crypto.randomUUID();

        if (isClientsFile(file.name)) {
          try {
            const map = parseClients(await file.text());
            setClients(map);
            setEntries((current) => [
              ...current,
              { id, kind: "clients", name: file.name, status: "ok", count: Object.keys(map).length },
            ]);
          } catch {
            setEntries((current) => [
              ...current,
              { id, kind: "clients", name: file.name, status: "error", message: "Fichier illisible." },
            ]);
          }
          continue;
        }

        if (!isOrderFile(file.name)) {
          setEntries((current) => [
            ...current,
            { id, kind: "order", name: file.name, status: "error", message: "Format non reconnu." },
          ]);
          continue;
        }

        try {
          const buffer = await file.arrayBuffer();
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
          const parsed = parseOrderSheet(rows, file.name, {});
          setEntries((current) => [...current, { id, kind: "order", name: file.name, status: "ok", rows: parsed }]);
        } catch (error) {
          const message = error instanceof HeaderMismatchError ? error.message : "Fichier illisible.";
          setEntries((current) => [...current, { id, kind: "order", name: file.name, status: "error", message }]);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = (id: string) => setEntries((current) => current.filter((entry) => entry.id !== id));

  const okOrders = entries.filter(
    (entry): entry is Extract<Entry, { kind: "order"; status: "ok" }> =>
      entry.kind === "order" && entry.status === "ok",
  );
  const totalLines = okOrders.reduce((sum, entry) => sum + entry.rows.length, 0);

  const generate = async () => {
    setBusy(true);
    try {
      const combined = okOrders.flatMap((entry) =>
        entry.rows.map((row) => ({ ...row, customer: clients[row.orderReference] ?? row.customer })),
      );
      const csv = buildOrdersCsv(combined);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      const file = new File([csv], `commandes_${stamp}.csv`, { type: "text/csv;charset=utf-8" });
      await shareOrDownloadCsv(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center gap-2 px-4 pb-4">
        <IconButton label="Retour" onClick={onBack}>
          <IconChevronLeft />
        </IconButton>
        <h1 className="text-[17px] font-semibold">Commande client</h1>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-6">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
          className={`flex flex-col items-center rounded-[10px] border border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-foreground bg-subtle" : "border-border-strong"
          }`}
        >
          <IconFileSpreadsheet className="h-6 w-6 text-faint" />
          <p className="mt-3 text-[15px] font-medium">Déposez les fichiers .xlsx</p>
          <p className="mt-1 text-[13px] text-muted">
            Un export « special order » par commande, et un éventuel clients.csv
          </p>
          <Button
            variant="secondary"
            block={false}
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="mt-4"
          >
            Choisir des fichiers
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.csv"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        {entries.length > 0 ? (
          <ul className="divide-y divide-border rounded-[10px] border border-border bg-panel">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] font-medium">{entry.name}</span>
                  {entry.status === "ok" ? (
                    <span className="block text-[13px] text-muted tabular-nums">
                      {entry.kind === "order" ? `${entry.rows.length} ligne${entry.rows.length > 1 ? "s" : ""}` : `${entry.count} client${entry.count > 1 ? "s" : ""}`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[13px] text-danger">
                      <IconAlert className="h-3.5 w-3.5 shrink-0" />
                      {entry.message}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  aria-label={`Retirer ${entry.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted active:bg-subtle"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <ActionBar>
          <Button disabled={busy || totalLines === 0} onClick={() => void generate()}>
            Générer le CSV ({totalLines} ligne{totalLines > 1 ? "s" : ""})
          </Button>
          <div className="h-3" />
        </ActionBar>
      ) : null}
    </main>
  );
}
