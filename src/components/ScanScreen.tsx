"use client";

import { useEffect, useRef, useState } from "react";

import { useCarton } from "@/lib/store";
import { useWakeLock } from "@/lib/useWakeLock";
import { SCAN_REGION, useBarcodeScanner } from "@/lib/useBarcodeScanner";
import { formatIsbn } from "@/lib/isbn";
import { play, unlockAudio } from "@/lib/feedback";
import { lookupOrders } from "@/lib/orders";
import {
  displayPublisher,
  expected,
  isComplete,
  isSpecialOrder,
  progress,
  sessionTitle,
  totalCounted,
  totalExpected,
} from "@/lib/order";
import { DAILY_ORDERS, type OrderLine } from "@/lib/types";
import { IconAlert, IconCheck, IconChevronRight, IconList } from "./icons";
import { proposeSplit } from "./OrderPicker";
import { QuantitySheet, type ScanConfirmation } from "./QuantitySheet";
import { UnknownCodeSheet } from "./UnknownCodeSheet";
import { Checklist } from "./Checklist";

interface Flash {
  id: number;
  /**
   * « special » et « other » distinguent la commande de destination —
   * special order en vert, une autre commande en bleu — sans rien dire de la
   * quantité. « alert » couvre les cas qui réclament un œil : écart de
   * quantité, hors bon de commande, exemplaire abîmé.
   */
  tone: "special" | "other" | "alert";
  counter: string;
  title: string;
  subtitle?: string;
}

/**
 * Vert quand toute la répartition part vers une special order, bleu vers une
 * autre commande.
 *
 * Rouge quand il n'y a aucune affectation : le livre est bien compté, mais il
 * n'est rattaché à personne — une recherche en échec, typiquement. C'était
 * bleu, donc impossible à distinguer d'un rangement réussi ; l'exemplaire
 * repartait dans la pile sans que rien ne dise qu'il faudrait y revenir.
 */
function allocationTone(allocations: ScanConfirmation["allocations"]): Flash["tone"] {
  if (allocations.length === 0) return "alert";
  return allocations.every((entry) => isSpecialOrder(entry.orderReference)) ? "special" : "other";
}

/** Le dernier livre compté, cible du bouton « Abîmé ». */
interface LastScan {
  id: string;
  title: string;
}

/**
 * Un code ignoré est écarté une minute.
 *
 * Assez pour poser le livre de côté sans que la feuille se rouvre en boucle,
 * assez peu pour qu'une fausse manœuvre se rattrape en le représentant. Un
 * blocage jusqu'à la fin du carton rendrait l'erreur irrécupérable, puisque
 * rien ne liste les codes écartés.
 */
const IGNORE_MS = 60 * 1000;

/** Le temps de reposer le livre après avoir refermé une feuille. */
const RESUME_MS = 2500;

/**
 * Le temps de retirer le livre du champ après une validation.
 *
 * Court exprès : un échange de livre prend bien plus longtemps que cela, donc
 * la cadence de scan n'en souffre pas, et aucune lecture n'est perdue — un
 * livre présenté pendant la pause est lu dès qu'elle expire. C'est seulement
 * assez pour que le geste de retrait ne balaie pas la pile posée à côté.
 */
const SETTLE_MS = 900;

export function ScanScreen() {
  const session = useCarton((state) => state.session);
  const handleScan = useCarton((state) => state.handleScan);
  const confirmScan = useCarton((state) => state.confirmScan);
  const addDamaged = useCarton((state) => state.addDamaged);
  const recordExtra = useCarton((state) => state.recordExtra);
  const requestSummary = useCarton((state) => state.requestSummary);

  const videoRef = useRef<HTMLVideoElement>(null);
  const flashTimer = useRef<number | null>(null);

  const [pendingLine, setPendingLine] = useState<OrderLine | null>(null);
  /**
   * Livre attendu en un seul exemplaire, le temps de savoir à quelle commande
   * il revient. Rien ne s'affiche pendant ce court instant — juste le flash
   * une fois la réponse là — mais le scan reste en pause pour ne pas lire le
   * même code une seconde fois avant que le premier passage soit enregistré.
   */
  const [resolving, setResolving] = useState<OrderLine | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);

  const paused =
    pendingLine !== null || resolving !== null || unknownCode !== null || showChecklist;

  const showFlash = (tone: Flash["tone"], counter: string, title: string, subtitle?: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ id: Date.now(), tone, counter, title, subtitle });
    flashTimer.current = window.setTimeout(() => setFlash(null), 1100);
  };

  /**
   * Livre attendu en un seul exemplaire, sans commande concurrente : rien à
   * arbitrer, donc pas de feuille à ouvrir — juste le flash, comme n'importe
   * quel autre livre compté. La commande de destination ne s'affiche nulle
   * part ici ; elle se retrouve au récapitulatif du carton et sur la fiche du
   * livre.
   */
  const confirmSingle = async (line: OrderLine) => {
    setResolving(line);

    let matches;
    try {
      matches = await lookupOrders(line.isbn);
    } catch {
      /*
       * Recherche en échec : exemplaire non affecté plutôt que rangé d'office
       * dans les commandes journalières sur la foi d'une panne. Le voile passe
       * au rouge et le dit — le livre est compté, mais il reste à rattacher, et
       * c'est maintenant qu'on peut le mettre de côté.
       */
      setResolving(null);
      record(line, { counted: 1, damaged: 0, allocations: [] });
      showFlash("alert", "1/1", line.title, "commande non vérifiée");
      return;
    }

    if (matches.length > 1) {
      // Plusieurs commandes se disputent le titre : la répartition se fait à
      // la main, dans la feuille complète.
      setResolving(null);
      setPendingLine(line);
      return;
    }

    const split = proposeSplit(matches, 1);
    const allocations =
      matches.length === 0
        ? [{ orderReference: DAILY_ORDERS, customer: "", quantity: 1 }]
        : matches
            .map((match) => ({
              orderReference: match.orderReference,
              customer: match.customer,
              quantity: split[match.orderReference] ?? 0,
            }))
            .filter((entry) => entry.quantity > 0);

    setResolving(null);
    record(line, { counted: 1, damaged: 0, allocations });
    showFlash(allocationTone(allocations), "1/1", line.title);
  };

  const onCode = (code: string) => {
    const outcome = handleScan(code);
    switch (outcome.kind) {
      case "found": {
        // Deux sons distincts : un titre déjà complet qui repasse devant
        // l'objectif est le cas qui mérite qu'on lève les yeux.
        play(outcome.alreadyComplete ? "attention" : "success");
        /*
         * La feuille de saisie ne s'ouvre que s'il y a une quantité à vérifier :
         * plusieurs exemplaires attendus, ou un titre déjà complet qui repasse.
         * Le reste — l'immense majorité des lignes — n'a qu'un exemplaire
         * attendu et se solde d'un flash.
         */
        if (expected(outcome.line) === 1 && !outcome.alreadyComplete) {
          void confirmSingle(outcome.line);
        } else {
          setPendingLine(outcome.line);
        }
        break;
      }
      case "unknown":
        play("failure");
        setUnknownCode(outcome.code);
        break;
    }
  };

  const { status, message, suppress, hold } = useBarcodeScanner({ videoRef, onCode, paused });

  useEffect(() => {
    unlockAudio();
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  useWakeLock(status === "running");

  const counted = totalCounted(session);
  const target = totalExpected(session);
  const remaining = session.lines.filter((line) => !isComplete(line)).length;

  /** Enregistre un livre compté, quel que soit l'écran qui l'a validé. */
  const record = (line: OrderLine, { counted, damaged, allocations }: ScanConfirmation) => {
    confirmScan(line.id, counted, damaged, allocations);
    setLastScan({ id: line.id, title: line.title });
    suppress(line.isbn, RESUME_MS);
    hold(SETTLE_MS);
  };

  const markDamaged = () => {
    if (!lastScan) return;
    const total = addDamaged(lastScan.id);
    play("attention");
    showFlash("alert", `${total}`, lastScan.title, total > 1 ? "abîmés signalés" : "abîmé signalé");
  };

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {status !== "running" ? (
        <p className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center text-[14px] text-white/70">
          {status === "denied" || status === "error" ? message : "Démarrage de la caméra…"}
        </p>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] border-2 border-white/70"
          style={{
            width: `${SCAN_REGION.width * 100}%`,
            height: `${SCAN_REGION.height * 100}%`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
          }}
        />
      )}

      <header className="pt-safe relative px-3">
        <div className="rounded-[10px] border border-white/15 bg-black/55 px-3 py-2.5 backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[13px] font-medium">{sessionTitle(session)}</p>
            <p className="shrink-0 font-mono text-[13px] tabular-nums">
              {counted}
              <span className="text-white/50">/{target}</span>
            </p>
          </div>
          <div className="mt-2 h-[2px] overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-white transition-[width] duration-300"
              style={{ width: `${Math.min(progress(session) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-white/50 tabular-nums">
            {remaining} titre{remaining > 1 ? "s" : ""} restant{remaining > 1 ? "s" : ""}
          </p>
        </div>
      </header>

      <div className="flex-1" />

      {/*
        Le bouton « Abîmé » porte sur le dernier livre scanné, et affiche son
        titre : c'est le seul moment où l'opérateur a l'exemplaire en main.
        Sans lui, un titre attendu en un seul exemplaire — validé d'office sans
        écran de saisie — ne pouvait pas être signalé du tout.
      */}
      <footer className="pb-safe relative space-y-2 px-3">
        {lastScan ? (
          <button
            type="button"
            onClick={markDamaged}
            className="flex w-full min-h-12 items-center justify-center gap-2 rounded-[10px] border border-white/25 bg-black/70 px-4 text-[14px] font-medium text-white backdrop-blur active:bg-white/15"
          >
            <IconAlert />
            <span className="truncate">Signaler abîmé · {lastScan.title}</span>
          </button>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowChecklist(true)}
            className="flex min-h-11 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3.5 text-[14px] backdrop-blur active:bg-black/70"
          >
            <IconList />
            Liste
          </button>
          <button
            type="button"
            onClick={requestSummary}
            className="flex min-h-11 items-center gap-1.5 rounded-[8px] border border-white/15 bg-black/55 px-3.5 text-[14px] font-medium backdrop-blur active:bg-black/70"
          >
            Fin du carton
            <IconChevronRight />
          </button>
        </div>
      </footer>

      {flash ? (
        <div
          key={flash.id}
          aria-live="polite"
          className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-white ${
            flash.tone === "alert"
              ? "bg-[#a4232a]/95"
              : flash.tone === "special"
                ? "bg-[#0f7b34]/95"
                : "bg-[#1d4ed8]/95"
          }`}
        >
          {flash.tone === "alert" ? (
            <IconAlert className="h-12 w-12" />
          ) : (
            <IconCheck className="h-12 w-12" />
          )}
          <p className="mt-3 font-mono text-[44px] leading-none font-medium tabular-nums">
            {flash.counter}
          </p>
          <p className="mt-5 line-clamp-2 text-[16px] font-medium">{flash.title}</p>
          {flash.subtitle ? (
            <p className="mt-1 truncate text-[13px] text-white/85">{flash.subtitle}</p>
          ) : null}
        </div>
      ) : null}

      {pendingLine ? (
        <QuantitySheet
          line={pendingLine}
          context="scan"
          onConfirm={(confirmation) => {
            const line = pendingLine;
            record(line, confirmation);
            setPendingLine(null);
            /*
             * Le voile confirme d'un coup d'œil que l'enregistrement a eu
             * lieu, et sa couleur dit si c'est parti vers une special order —
             * le nom de la commande, lui, ne s'y affiche pas : il se retrouve
             * au récapitulatif du carton et sur la fiche du livre.
             */
            showFlash(
              confirmation.counted === expected(line)
                ? allocationTone(confirmation.allocations)
                : "alert",
              `${confirmation.counted}/${expected(line)}`,
              line.title,
            );
          }}
          onCancel={() => {
            setPendingLine(null);
            suppress(pendingLine.isbn, RESUME_MS);
            hold(SETTLE_MS);
          }}
        />
      ) : null}

      {unknownCode ? (
        <UnknownCodeSheet
          code={unknownCode}
          onRecord={() => {
            recordExtra(unknownCode);
            setUnknownCode(null);
            suppress(unknownCode, RESUME_MS);
            hold(SETTLE_MS);
            showFlash("alert", "+1", "Hors bon de commande", formatIsbn(unknownCode));
          }}
          onIgnore={() => {
            setUnknownCode(null);
            // Ignoré une fois, ignoré pour le reste du carton : sans cela, le
            // livre encore devant l'objectif rouvre la feuille en boucle.
            suppress(unknownCode, IGNORE_MS);
            hold(SETTLE_MS);
          }}
        />
      ) : null}

      {showChecklist ? <Checklist onClose={() => setShowChecklist(false)} /> : null}
    </main>
  );
}
