"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { del, get, set } from "idb-keyval";

import { auditStructure, consolidate, mergeNotDelivered, toOrderLines } from "./reconciler";
import { prepareForUpload } from "./images";
import { clearPages, savePage } from "./pages";
import { normalizeIsbn } from "./isbn";
import { migrateSession, toExtractedPage } from "./payload";
import {
  expected,
  findExtraIndex,
  findLineIndex,
  isComplete,
  isReviewComplete,
  mergeDuplicateIsbns,
} from "./order";
import { emptySession } from "./types";
import type {
  CartonSession,
  ExtractedNotDelivered,
  ExtractedPage,
  OrderLine,
} from "./types";

export type Phase = "idle" | "processing" | "review" | "scanning" | "summary";

export interface OcrProgress {
  pageIndex: number;
  pageCount: number;
  stage: string;
}

/**
 * Résultat d'un code lu, qui pilote ce que l'écran de scan affiche.
 *
 * Il n'y a plus de validation d'office. Un exemplaire compté est désormais un
 * exemplaire affecté à une commande client : personne d'autre que l'opérateur,
 * le livre en main, ne peut décider laquelle. L'écran s'ouvre donc à chaque
 * livre, y compris sur une ligne attendue en un seul exemplaire.
 */
export type ScanOutcome =
  /** Le code figure au bon : l'écran de validation s'ouvre. */
  | { kind: "found"; line: OrderLine; alreadyComplete: boolean }
  /** Code absent du bon de commande. */
  | { kind: "unknown"; code: string };

interface CartonState {
  phase: Phase;
  session: CartonSession;
  progress: OcrProgress | null;
  error: string | null;
  soundEnabled: boolean;

  setError: (error: string | null) => void;
  setSoundEnabled: (value: boolean) => void;

  processPages: (files: Blob[]) => Promise<void>;

  resolveLine: (id: string, updated: OrderLine) => void;
  deleteLine: (id: string) => void;
  addManualLine: () => OrderLine;
  confirmVariant: (id: string) => void;
  validateOrder: () => void;

  handleScan: (code: string) => ScanOutcome;
  confirmScan: (
    id: string,
    counted: number,
    damaged: number,
    allocations: ReadonlyArray<{
      orderReference: string;
      customer: string;
      quantity: number;
      discountPercent: number | null;
    }>,
  ) => void;
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
 * Une page perdue, c'est un appel OCR déjà payé et une attente à recommencer.
 * Sur un incident passager — coupure de wifi d'entrepôt, 502 de passage, quota
 * momentané — on retente une fois avant d'abandonner le carton.
 */
async function readPage(dataUrl: string): Promise<ExtractedPage> {
  try {
    return await readPageOnce(dataUrl);
  } catch (error) {
    if (!(error instanceof ReadError) || !error.transient) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return readPageOnce(dataUrl);
  }
}

async function readPageOnce(dataUrl: string): Promise<ExtractedPage> {
  let response: Response;
  try {
    response = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
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
  if (!payload || typeof payload.page !== "object" || payload.page === null) {
    throw new Error("Réponse illisible du serveur. Rechargez la page et réessayez.");
  }

  const page = toExtractedPage(payload.page);
  if (page.lines.length === 0) {
    throw new Error("Aucune ligne de livre n'a été détectée sur cette page.");
  }

  return page;
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
          progress: { pageIndex: 0, pageCount: files.length, stage: "Préparation…" },
        });

        const notDeliveredRaw: ExtractedNotDelivered[] = [];
        let supplier = "";
        let reference = "";
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

            const page = await readPage(dataUrl);

            supplier = supplier || page.supplier || "";
            reference = reference || page.reference || "";
            notDeliveredRaw.push(...page.notDelivered);

            // Les totaux sont imprimés au niveau du document, souvent répétés
            // sur chaque page : on retient le plus grand vu.
            declaredQuantity = Math.max(declaredQuantity, page.declaredTotalQuantity);
            declaredArticles = Math.max(declaredArticles, page.declaredTotalArticles);

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

            return toOrderLines(page, index);
          });

          const lines = auditStructure(consolidate(perPage));
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

      /*
       * La fusion qui suit n'est pas une commodité : corriger un ISBN peut le
       * rendre identique à celui d'une ligne voisine, et la recherche au scan
       * s'arrêtant à la première correspondance, la seconde deviendrait
       * injoignable — le carton se clôturerait sur un manque impossible à
       * solder.
       */
      resolveLine: (id, updated) =>
        setState((state) => ({
          session: {
            ...state.session,
            lines: mergeDuplicateIsbns(
              state.session.lines.map((line) =>
                line.id === id ? { ...updated, issues: [] } : line,
              ),
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
          reference: "",
          isbn: "",
          title: "",
          publisher: "",
          quantityOrdered: 1,
          quantityDelivered: 1,
          pageIndex: 0,
          issues: [
            {
              id: crypto.randomUUID(),
              field: "isbn",
              kind: "missing",
              severity: "blocking",
              candidateA: "",
              candidateB: "",
            },
          ],
          counted: 0,
          damaged: 0,
        };
        setState((state) => ({
          session: { ...state.session, lines: [...state.session.lines, line] },
        }));
        return line;
      },

      /**
       * Lève le signalement de variante sur une seule ligne.
       *
       * Un ISBN à la fois : sur une série dont les trois tomes portent le même
       * libellé, valider le groupe d'un geste reviendrait à ne rien vérifier.
       */
      confirmVariant: (id) =>
        setState((state) => ({
          session: {
            ...state.session,
            lines: state.session.lines.map((line) =>
              line.id === id
                ? {
                    ...line,
                    issues: line.issues.filter((entry) => entry.kind !== "duplicateTitle"),
                  }
                : line,
            ),
          },
        })),

      validateOrder: () => {
        const state = getState();
        if (!isReviewComplete(state.session)) return;
        setState({
          phase: "scanning",
          session: { ...state.session, lines: mergeDuplicateIsbns(state.session.lines) },
        });
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
        return { kind: "found", line, alreadyComplete: isComplete(line) };
      },

      /**
       * Valide un livre scanné : ce qui est compté, et pour qui.
       *
       * Les affectations de cet ISBN sont remplacées, jamais cumulées. L'écran
       * de validation montre la répartition entière du titre : rouvrir la même
       * ligne pour se corriger doit donc écraser ce qui y était, sinon une
       * correction ajouterait des exemplaires au lieu d'en déplacer.
       */
      confirmScan: (id, counted, damaged, allocations) =>
        setState((state) => {
          const line = state.session.lines.find((entry) => entry.id === id);
          if (!line) return {};

          const key = normalizeIsbn(line.isbn);

          return {
            session: {
              ...state.session,
              lines: state.session.lines.map((entry) =>
                entry.id === id
                  ? {
                      ...entry,
                      counted: Math.max(counted, 0),
                      damaged: Math.max(damaged, 0),
                    }
                  : entry,
              ),
              allocations: [
                ...state.session.allocations.filter(
                  (entry) => normalizeIsbn(entry.isbn) !== key,
                ),
                ...allocations
                  .filter((entry) => entry.quantity > 0 && entry.orderReference)
                  .map((entry) => ({
                    id: crypto.randomUUID(),
                    isbn: key,
                    orderReference: entry.orderReference,
                    customer: entry.customer,
                    quantity: Math.max(Math.trunc(entry.quantity), 0),
                    discountPercent: entry.discountPercent,
                  })),
              ],
            },
          };
        }),

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
        });
      },

      abandonCarton: async () => {
        await clearPages();
        setState({
          phase: "idle",
          session: emptySession(),
          progress: null,
          error: null,
        });
      },

      loadDemoOrder: () => {
        setState({
          phase: "review",
          session: makeDemoSession(),
          progress: null,
          error: null,
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
      version: 5,
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
    reference: "",
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
 *
 * Les anomalies sont volontaires et couvrent les deux régimes : ce qui doit
 * remonter à l'opérateur — clé ISBN cassée, ISBN rattaché au mauvais titre,
 * quantité absente — et ce qui doit rester une simple mention : titre non lu,
 * doublon fusionné, série dont les tomes partagent un libellé.
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
      // Clé de contrôle volontairement fausse : le bon chiffre est 7.
      demoLine("9782070782010", "COFFRET LE PETIT NICOLAS", "GALLIMARD JEUNE", 2, 2, 1, [
        {
          id: crypto.randomUUID(),
          field: "isbn",
          kind: "invalidChecksum",
          severity: "blocking",
          candidateA: "9782070782010",
          candidateB: "",
        },
      ]),
      // Le même ISBN lu sur deux pages, quantités fusionnées : simple mention.
      demoLine("9782072678455", "PROTOCOLES MAPAR 2025", "MAPAR", 1, 1, 1, [
        {
          id: crypto.randomUUID(),
          field: "quantityDelivered",
          kind: "merged",
          severity: "info",
          candidateA: "1",
          candidateB: "2 lignes pour un même ISBN",
        },
      ]),
      // Deux tomes d'une série édités sous le même libellé : à vérifier, pas à
      // trancher.
      ...["9782075036948", "9782075036955"].map((isbn) =>
        demoLine(isbn, "HARRY POTTER", "GALLIMARD JEUNE", 2, 2, 1, [
          {
            id: crypto.randomUUID(),
            field: "title",
            kind: "duplicateTitle",
            severity: "info",
            candidateA: "HARRY POTTER",
            candidateB: "9782075036948 / 9782075036955",
          },
        ]),
      ),
      // Un ISBN retrouvé sur deux titres sans rapport : décalage de bloc.
      demoLine("9782070179268", "BERSERK T43 COLLECTOR", "GLENAT", 6, 6, 1, [
        {
          id: crypto.randomUUID(),
          field: "title",
          kind: "alignment",
          severity: "blocking",
          candidateA: "BERSERK T43 COLLECTOR",
          candidateB: "CAP CANAILLE",
        },
      ]),
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
