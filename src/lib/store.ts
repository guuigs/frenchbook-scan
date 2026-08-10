"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { del, get, set } from "idb-keyval";

import { consolidate, mergeNotDelivered, reconcile } from "./reconciler";
import { prepareForUpload } from "./images";
import { clearPages, savePage } from "./pages";
import { normalizeIsbn } from "./isbn";
import { migrateSession, toExtractedPage } from "./payload";
import { expected, findExtraIndex, findLineIndex, isComplete, isReviewComplete } from "./order";
import { emptySession } from "./types";
import type {
  CartonSession,
  ExtractedNotDelivered,
  OcrPageResponse,
  OrderLine,
} from "./types";

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
  addDamaged: (id: string) => number;
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

/** Erreur de lecture, distinguant ce qui mérite une seconde tentative. */
class ReadError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "ReadError";
  }
}

/**
 * Une page perdue, c'est deux appels OCR déjà payés et une attente à
 * recommencer. Sur un incident passager — coupure de wifi d'entrepôt, 502 de
 * passage, quota momentané — on retente une fois avant d'abandonner le carton.
 */
async function readPage(dataUrl: string, doubleCheck: boolean): Promise<OcrPageResponse> {
  try {
    return await readPageOnce(dataUrl, doubleCheck);
  } catch (error) {
    if (!(error instanceof ReadError) || !error.transient) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return readPageOnce(dataUrl, doubleCheck);
  }
}

async function readPageOnce(dataUrl: string, doubleCheck: boolean): Promise<OcrPageResponse> {
  let response: Response;
  try {
    response = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, doubleCheck }),
    });
  } catch {
    throw new ReadError("Réseau indisponible. Vérifiez la connexion de l’appareil.", true);
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message = payload && typeof payload.error === "string" ? payload.error : null;
    throw new ReadError(
      message ?? `Lecture impossible (${response.status}).`,
      response.status >= 500 || response.status === 429,
    );
  }
  if (!payload || typeof payload.engineA !== "object" || payload.engineA === null) {
    throw new Error("Réponse illisible du serveur. Rechargez la page et réessayez.");
  }

  const engineA = toExtractedPage(payload.engineA);
  if (engineA.lines.length === 0) {
    throw new Error("Aucune ligne de livre n'a été détectée sur cette page.");
  }

  return {
    engineA,
    engineB:
      payload.engineB && typeof payload.engineB === "object"
        ? toExtractedPage(payload.engineB)
        : null,
    degraded: payload.degraded === true,
  };
}

/**
 * `Promise.all` sur toutes les pages saturerait le réseau et les quotas de
 * l'API ; une boucle séquentielle fait attendre l'opérateur autant de fois
 * qu'il y a de pages. On garde donc N tâches en vol, et l'ordre des résultats.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

        const notDeliveredRaw: ExtractedNotDelivered[] = [];
        let supplier = "";
        let reference = "";
        let degraded = false;
        let declaredQuantity = 0;
        let declaredArticles = 0;
        let done = 0;

        try {
          /*
           * Les pages étaient lues l'une après l'autre : sur un bon de six
           * pages, l'opérateur attendait six fois le temps d'un aller-retour
           * Mistral. Elles sont indépendantes, donc on les traite en parallèle.
           * La limite à trois évite de saturer la bande passante de l'entrepôt
           * et de déclencher les quotas de l'API.
           */
          const perPage = await mapWithConcurrency(files, 3, async (file, index) => {
            const dataUrl = await prepareForUpload(file);
            await savePage(index, dataUrl);

            const result = await readPage(dataUrl, true);

            degraded = degraded || result.degraded;
            supplier = supplier || result.engineA.supplier || result.engineB?.supplier || "";
            reference = reference || result.engineA.reference || result.engineB?.reference || "";

            // Les articles non servis viennent des deux moteurs : on prend
            // l'union, `mergeNotDelivered` dédoublonne ensuite.
            notDeliveredRaw.push(...result.engineA.notDelivered);
            if (result.engineB) notDeliveredRaw.push(...result.engineB.notDelivered);

            // Les totaux sont imprimés au niveau du document, souvent répétés
            // sur chaque page : on retient le plus grand vu.
            declaredQuantity = Math.max(
              declaredQuantity,
              result.engineA.declaredTotalQuantity,
              result.engineB?.declaredTotalQuantity ?? 0,
            );
            declaredArticles = Math.max(
              declaredArticles,
              result.engineA.declaredTotalArticles,
              result.engineB?.declaredTotalArticles ?? 0,
            );

            done += 1;
            setState({
              progress: {
                pageIndex: done,
                pageCount: files.length,
                stage:
                  done === files.length
                    ? "Consolidation…"
                    : `Lecture de ${files.length} pages en parallèle…`,
              },
            });

            return reconcile(result.engineA, result.engineB, index);
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
              notDelivered: mergeNotDelivered(notDeliveredRaw),
              declaredTotalQuantity: declaredQuantity,
              declaredTotalArticles: declaredArticles,
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
          publisher: "",
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

      /**
       * Signale un exemplaire abîmé de plus sur une ligne, sans toucher au
       * comptage : un livre abîmé est reçu, il est simplement à signaler.
       * Plafonné au nombre compté, pour ne pas déclarer trois abîmés sur deux
       * exemplaires reçus.
       */
      addDamaged: (id) => {
        const line = getState().session.lines.find((entry) => entry.id === id);
        if (!line) return 0;
        const damaged = Math.min(line.damaged + 1, Math.max(line.counted, 1));
        setState((state) => ({
          session: {
            ...state.session,
            lines: state.session.lines.map((entry) =>
              entry.id === id ? { ...entry, damaged } : entry,
            ),
          },
        }));
        return damaged;
      },

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
      /**
       * Incrémenté à chaque changement de forme de `CartonSession`. Sans cela,
       * un carton entamé sur une version précédente serait relu avec des champs
       * manquants — et l'opérateur perdrait son comptage en cours sur une
       * erreur incompréhensible.
       */
      version: 2,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...(state as unknown as CartonState),
          session: migrateSession(state.session),
        };
      },
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
  publisher: string,
  quantityOrdered: number,
  quantityDelivered: number,
  pageIndex: number,
  issues: OrderLine["issues"] = [],
): OrderLine {
  return {
    id: crypto.randomUUID(),
    isbn,
    title,
    publisher,
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
      demoLine("9782070368228", "COMTE DE MONTE CRISTO", "FOLIO", 1, 1, 0),
      demoLine("9782070612758", "ARSENE LUPIN, GENTLEMAN", "GALLIMARD JEUNE", 3, 3, 0),
      demoLine("9782021400984", "FIGURES DU FOU", "GALLIMARD", 5, 5, 0, [
        {
          id: crypto.randomUUID(),
          field: "title",
          kind: "conflict",
          candidateA: "FIGURES DU FOU",
          candidateB: "FIGURE DU FOU",
        },
      ]),
      // Clé de contrôle volontairement fausse : le bon chiffre est 7.
      demoLine("9782070782010", "COFFRET LE PETIT NICOLAS", "GALLIMARD JEUNE", 2, 2, 1, [
        {
          id: crypto.randomUUID(),
          field: "isbn",
          kind: "invalidChecksum",
          candidateA: "9782070782010",
          candidateB: "",
        },
      ]),
      demoLine("9782213242583", "MES MUSIQUES DU MONDE", "GALLIMARD JEUNE", 4, 2, 1),
      demoLine("9782072678455", "PROTOCOLES MAPAR 2025", "MAPAR", 1, 1, 1, [
        {
          id: crypto.randomUUID(),
          field: "title",
          kind: "singleSource",
          candidateA: "— absente de la 1ʳᵉ lecture —",
          candidateB: "PROTOCOLES MAPAR 2025",
        },
      ]),
      demoLine("9782070179268", "BERSERK T43 COLLECTOR", "GLENAT", 6, 6, 1),
    ],
    // Reproduit la section « NON-SERVI DE VOTRE LIVRAISON » d'un bon SODIS.
    notDelivered: [
      {
        id: crypto.randomUUID(),
        isbn: "9781838662202",
        title: "SEPTIME",
        publisher: "PHAIDON GB",
        quantity: 1,
        reason: "MANQUANT PAS NOTE",
      },
    ],
    declaredTotalQuantity: 22,
    declaredTotalArticles: 7,
  };
}
