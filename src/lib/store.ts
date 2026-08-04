"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { del, get, set } from "idb-keyval";

import { consolidate, reconcile } from "./reconciler";
import { prepareForUpload } from "./images";
import { clearPages, savePage } from "./pages";
import { normalizeIsbn } from "./isbn";
import { expected, findExtraIndex, findLineIndex, isComplete, isReviewComplete } from "./order";
import { emptySession } from "./types";
import type { CartonSession, OcrPageResponse, OrderLine } from "./types";

export type Phase = "idle" | "processing" | "review" | "scanning" | "summary";

export interface OcrProgress {
  pageIndex: number;
  pageCount: number;
  stage: string;
}

/** Résultat d'un code lu, qui pilote ce que l'écran de scan affiche. */
export type ScanOutcome =
  /** Quantité attendue de 1 : validé d'office, confirmation flash. */
  | { kind: "autoConfirmed"; line: OrderLine }
  /** Quantité attendue > 1 : demande de confirmation à l'opérateur. */
  | { kind: "needsQuantity"; line: OrderLine }
  /** Ligne déjà complète : nouveau scan = surplus à arbitrer. */
  | { kind: "alreadyComplete"; line: OrderLine }
  /** Code absent du bon de commande. */
  | { kind: "unknown"; code: string };

interface CartonState {
  phase: Phase;
  session: CartonSession;
  progress: OcrProgress | null;
  error: string | null;
  degraded: boolean;
  soundEnabled: boolean;

  setError: (error: string | null) => void;
  setSoundEnabled: (value: boolean) => void;

  processPages: (files: Blob[]) => Promise<void>;

  resolveLine: (id: string, updated: OrderLine) => void;
  deleteLine: (id: string) => void;
  addManualLine: () => OrderLine;
  validateOrder: () => void;

  handleScan: (code: string) => ScanOutcome;
  setCount: (id: string, counted: number, damaged: number) => void;
  recordExtra: (isbn: string) => void;
  removeExtra: (id: string) => void;

  requestSummary: () => void;
  returnToScanning: () => void;
  closeCarton: () => Promise<void>;
  abandonCarton: () => Promise<void>;

  loadDemoOrder: () => void;
}

/**
 * IndexedDB plutôt que localStorage : un bon de commande de deux cents lignes
 * dépasse allègrement les quotas de `localStorage` sur Safari, et l'écriture y
 * est synchrone — elle ferait tressauter l'écran de scan à chaque livre.
 */
const idbStorage = {
  getItem: async (name: string) => (await get<string>(name)) ?? null,
  setItem: async (name: string, value: string) => {
    await set(name, value);
  },
  removeItem: async (name: string) => {
    await del(name);
  },
};

async function readPage(
  dataUrl: string,
  doubleCheck: boolean,
): Promise<OcrPageResponse> {
  const response = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl, doubleCheck }),
  });

  const payload = (await response.json()) as Partial<OcrPageResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Lecture impossible (${response.status}).`);
  }
  if (!payload.engineA) {
    throw new Error("Le moteur n'a détecté aucune ligne sur cette page.");
  }

  return {
    engineA: payload.engineA,
    engineB: payload.engineB ?? null,
    degraded: payload.degraded ?? false,
  };
}

export const useCarton = create<CartonState>()(
  persist(
    (setState, getState) => ({
      phase: "idle",
      session: emptySession(),
      progress: null,
      error: null,
      degraded: false,
      soundEnabled: true,

      setError: (error) => setState({ error }),
      setSoundEnabled: (soundEnabled) => setState({ soundEnabled }),

      // MARK: - Phase 1 — lecture du bon de commande

      processPages: async (files) => {
        if (files.length === 0) return;

        await clearPages();
        setState({
          phase: "processing",
          error: null,
          degraded: false,
          progress: { pageIndex: 0, pageCount: files.length, stage: "Préparation…" },
        });

        const perPage: OrderLine[][] = [];
        let supplier = "";
        let reference = "";
        let degraded = false;

        try {
          for (let index = 0; index < files.length; index += 1) {
            setState({
              progress: {
                pageIndex: index,
                pageCount: files.length,
                stage: `Double lecture de la page ${index + 1}…`,
              },
            });

            const dataUrl = await prepareForUpload(files[index]);
            await savePage(index, dataUrl);

            const result = await readPage(dataUrl, true);
            degraded = degraded || result.degraded;

            supplier = supplier || result.engineA.supplier || result.engineB?.supplier || "";
            reference = reference || result.engineA.reference || result.engineB?.reference || "";

            perPage.push(reconcile(result.engineA, result.engineB, index));
          }

          setState({
            progress: { pageIndex: files.length, pageCount: files.length, stage: "Consolidation…" },
          });

          const lines = consolidate(perPage);
          if (lines.length === 0) {
            throw new Error("Aucune ligne de livre n'a été détectée sur ces pages.");
          }

          setState({
            session: {
              ...emptySession(),
              supplier: supplier.trim(),
              reference: reference.trim(),
              pageCount: files.length,
              lines,
            },
            progress: null,
            degraded,
            phase: "review",
          });
        } catch (error) {
          await clearPages();
          setState({
            progress: null,
            phase: "idle",
            error: error instanceof Error ? error.message : "Lecture impossible.",
          });
        }
      },

      // MARK: - Phase 2 — contrôle des lignes

      resolveLine: (id, updated) =>
        setState((state) => ({
          session: {
            ...state.session,
            lines: state.session.lines.map((line) =>
              line.id === id ? { ...updated, issues: [] } : line,
            ),
          },
        })),

      deleteLine: (id) =>
        setState((state) => ({
          session: {
            ...state.session,
            lines: state.session.lines.filter((line) => line.id !== id),
          },
        })),

      addManualLine: () => {
        const line: OrderLine = {
          id: crypto.randomUUID(),
          isbn: "",
          title: "",
          author: "",
          quantityOrdered: 1,
          quantityDelivered: 1,
          pageIndex: 0,
          issues: [
            { id: crypto.randomUUID(), field: "isbn", kind: "missing", candidateA: "", candidateB: "" },
          ],
          counted: 0,
          damaged: 0,
        };
        setState((state) => ({
          session: { ...state.session, lines: [...state.session.lines, line] },
        }));
        return line;
      },

      validateOrder: () => {
        if (!isReviewComplete(getState().session)) return;
        setState({ phase: "scanning" });
      },

      // MARK: - Phase 3 — comptage physique

      handleScan: (code) => {
        const state = getState();
        const normalized = normalizeIsbn(code);
        const index = findLineIndex(state.session, normalized);

        if (index < 0) {
          return { kind: "unknown", code: normalized };
        }

        const line = state.session.lines[index];

        if (isComplete(line)) {
          return { kind: "alreadyComplete", line };
        }

        if (expected(line) === 1) {
          const lines = [...state.session.lines];
          lines[index] = { ...line, counted: 1 };
          setState({ session: { ...state.session, lines } });
          return { kind: "autoConfirmed", line: lines[index] };
        }

        return { kind: "needsQuantity", line };
      },

      setCount: (id, counted, damaged) =>
        setState((state) => ({
          session: {
            ...state.session,
            lines: state.session.lines.map((line) =>
              line.id === id
                ? { ...line, counted: Math.max(counted, 0), damaged: Math.max(damaged, 0) }
                : line,
            ),
          },
        })),

      recordExtra: (isbn) =>
        setState((state) => {
          const normalized = normalizeIsbn(isbn);
          const index = findExtraIndex(state.session, normalized);
          if (index >= 0) {
            const extras = [...state.session.extras];
            extras[index] = { ...extras[index], counted: extras[index].counted + 1 };
            return { session: { ...state.session, extras } };
          }
          return {
            session: {
              ...state.session,
              extras: [
                ...state.session.extras,
                { id: crypto.randomUUID(), isbn: normalized, counted: 1, damaged: 0 },
              ],
            },
          };
        }),

      removeExtra: (id) =>
        setState((state) => ({
          session: {
            ...state.session,
            extras: state.session.extras.filter((extra) => extra.id !== id),
          },
        })),

      // MARK: - Phase 4 — récapitulatif et clôture

      requestSummary: () => setState({ phase: "summary" }),
      returnToScanning: () => setState({ phase: "scanning" }),

      closeCarton: async () => {
        await clearPages();
        setState({
          phase: "idle",
          session: emptySession(),
          progress: null,
          error: null,
          degraded: false,
        });
      },

      abandonCarton: async () => {
        await clearPages();
        setState({
          phase: "idle",
          session: emptySession(),
          progress: null,
          error: null,
          degraded: false,
        });
      },

      loadDemoOrder: () => {
        setState({
          phase: "review",
          session: makeDemoSession(),
          progress: null,
          error: null,
          degraded: false,
        });
      },
    }),
    {
      name: "frenchbook-carton",
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        phase: state.phase,
        session: state.session,
        degraded: state.degraded,
        soundEnabled: state.soundEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        // Une lecture OCR interrompue par une fermeture d'onglet ne peut pas
        // reprendre : on repart de l'accueil plutôt que de rester bloqué sur
        // un écran de progression figé.
        if (state?.phase === "processing") {
          state.phase = "idle";
          state.progress = null;
        }
      },
    },
  ),
);

function demoLine(
  isbn: string,
  title: string,
  author: string,
  quantityOrdered: number,
  quantityDelivered: number,
  pageIndex: number,
  issues: OrderLine["issues"] = [],
): OrderLine {
  return {
    id: crypto.randomUUID(),
    isbn,
    title,
    author,
    quantityOrdered,
    quantityDelivered,
    pageIndex,
    issues,
    counted: 0,
    damaged: 0,
  };
}

/**
 * Bon fictif pour parcourir tout le flux sans photo ni appel Mistral.
 * Les anomalies sont volontaires : une divergence de lecture, une clé ISBN
 * cassée et une ligne à source unique, de quoi éprouver chaque branche de
 * l'écran de contrôle.
 */
function makeDemoSession(): CartonSession {
  return {
    ...emptySession(),
    supplier: "Éditions de démonstration",
    reference: "BC-DEMO-4871",
    pageCount: 2,
    lines: [
      demoLine("9782070368228", "Le Petit Prince", "Antoine de Saint-Exupéry", 1, 1, 0),
      demoLine("9782070612758", "L’Étranger", "Albert Camus", 3, 3, 0),
      demoLine("9782021400984", "Les Misérables — tome I", "Victor Hugo", 5, 5, 0, [
        {
          id: crypto.randomUUID(),
          field: "title",
          kind: "conflict",
          candidateA: "Les Misérables — tome I",
          candidateB: "Les Misérables — tome 1",
        },
      ]),
      // Clé de contrôle volontairement fausse : le bon chiffre est 7.
      demoLine("9782070782010", "Voyage au bout de la nuit", "Louis-Ferdinand Céline", 2, 2, 1, [
        {
          id: crypto.randomUUID(),
          field: "isbn",
          kind: "invalidChecksum",
          candidateA: "9782070782010",
          candidateB: "",
        },
      ]),
      demoLine("9782213242583", "Madame Bovary", "Gustave Flaubert", 4, 2, 1),
      demoLine("9782072678455", "La Peste", "Albert Camus", 1, 1, 1, [
        {
          id: crypto.randomUUID(),
          field: "title",
          kind: "singleSource",
          candidateA: "— absente de la 1ʳᵉ lecture —",
          candidateB: "La Peste",
        },
      ]),
      demoLine("9782070179268", "Bel-Ami", "Guy de Maupassant", 6, 6, 1),
    ],
  };
}
