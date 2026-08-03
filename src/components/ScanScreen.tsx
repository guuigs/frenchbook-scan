"use client";

import { useEffect, useRef, useState } from "react";

import { useCarton } from "@/lib/store";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import { formatIsbn } from "@/lib/isbn";
import { play, unlockAudio } from "@/lib/feedback";
import {
  displayAuthor,
  expected,
  isComplete,
  progress,
  sessionTitle,
  totalCounted,
  totalExpected,
} from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { QuantitySheet } from "./QuantitySheet";
import { UnknownCodeSheet } from "./UnknownCodeSheet";
import { Checklist } from "./Checklist";

interface Flash {
  id: number;
  tone: "ok" | "warning";
  counter: string;
  title: string;
  subtitle: string;
}

/**
 * Poste de scan : la caméra ne s'arrête jamais.
 *
 * Sans retour haptique possible dans Safari, la confirmation repose entièrement
 * sur le son et sur un voile de couleur plein écran : l'opérateur doit pouvoir
 * savoir qu'un livre est compté sans fixer l'écran.
 */
export function ScanScreen() {
  const session = useCarton((state) => state.session);
  const handleScan = useCarton((state) => state.handleScan);
  const setCount = useCarton((state) => state.setCount);
  const recordExtra = useCarton((state) => state.recordExtra);
  const requestSummary = useCarton((state) => state.requestSummary);

  const videoRef = useRef<HTMLVideoElement>(null);
  const flashTimer = useRef<number | null>(null);

  const [pendingLine, setPendingLine] = useState<OrderLine | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);

  const paused = pendingLine !== null || unknownCode !== null || showChecklist;

  const showFlash = (tone: Flash["tone"], counter: string, title: string, subtitle: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ id: Date.now(), tone, counter, title, subtitle });
    flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
  };

  const onCode = (code: string) => {
    const outcome = handleScan(code);
    switch (outcome.kind) {
      case "autoConfirmed":
        play("success");
        showFlash("ok", "1/1", outcome.line.title, displayAuthor(outcome.line));
        break;
      case "needsQuantity":
      case "alreadyComplete":
        play("attention");
        setPendingLine(outcome.line);
        break;
      case "unknown":
        play("failure");
        setUnknownCode(outcome.code);
        break;
    }
  };

  const { status, message, clearDebounce } = useBarcodeScanner({ videoRef, onCode, paused });

  // Le son doit être débloqué par un geste utilisateur : l'écran de scan est
  // toujours atteint depuis un bouton, ce qui suffit à iOS.
  useEffect(() => {
    unlockAudio();
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  useWakeLock(status === "running");

  const resume = () => clearDebounce();

  const counted = totalCounted(session);
  const target = totalExpected(session);
  const remainingTitles = session.lines.filter((line) => !isComplete(line)).length;

  return (
    <main className="fixed inset-0 flex flex-col bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {status !== "running" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center">
          <p className="text-white/80">
            {status === "denied" || status === "error"
              ? message
              : "Démarrage de la caméra…"}
          </p>
        </div>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 h-40 w-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-dashed border-white/60"
        />
      )}

      <header className="pt-safe relative px-3 pt-2">
        <div className="rounded-2xl bg-black/45 p-3 backdrop-blur">
          <div className="flex items-baseline justify-between text-white">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{sessionTitle(session)}</p>
              {session.reference ? (
                <p className="truncate text-xs text-white/60">{session.reference}</p>
              ) : null}
            </div>
            <p className="ml-3 shrink-0 text-sm font-semibold tabular-nums">
              {counted} / {target}
            </p>
          </div>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
              style={{ width: `${Math.min(progress(session) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-white/70">
            {remainingTitles} titre(s) restant(s) à trouver
          </p>
        </div>
      </header>

      <div className="flex-1" />

      <footer className="pb-safe relative flex items-center justify-between px-4 pb-2">
        <button
          type="button"
          onClick={() => setShowChecklist(true)}
          className="min-h-11 rounded-full bg-black/45 px-4 text-sm font-medium text-white backdrop-blur active:bg-black/60"
        >
          ☰ Liste
        </button>
        <button
          type="button"
          onClick={requestSummary}
          className="min-h-11 rounded-full bg-black/45 px-4 text-sm font-semibold text-white backdrop-blur active:bg-black/60"
        >
          Fin du carton ›
        </button>
      </footer>

      {flash ? (
        <div
          key={flash.id}
          aria-live="polite"
          className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-white ${
            flash.tone === "ok" ? "bg-emerald-600/90" : "bg-amber-600/90"
          }`}
        >
          <span className="text-7xl">✓</span>
          <span className="mt-2 text-5xl font-bold tabular-nums">{flash.counter}</span>
          <span className="mt-4 max-w-xs px-6 text-center text-lg font-semibold">{flash.title}</span>
          <span className="mt-1 max-w-xs truncate px-6 text-sm text-white/80">{flash.subtitle}</span>
        </div>
      ) : null}

      {pendingLine ? (
        <QuantitySheet
          line={pendingLine}
          context="scan"
          onConfirm={(count, damaged) => {
            setCount(pendingLine.id, count, damaged);
            const done = count === expected(pendingLine);
            setPendingLine(null);
            resume();
            showFlash(
              done ? "ok" : "warning",
              `${count}/${expected(pendingLine)}`,
              pendingLine.title,
              damaged > 0 ? `${damaged} abîmé(s) signalé(s)` : "Quantité enregistrée",
            );
          }}
          onCancel={() => {
            setPendingLine(null);
            resume();
          }}
        />
      ) : null}

      {unknownCode ? (
        <UnknownCodeSheet
          code={unknownCode}
          onRecord={() => {
            recordExtra(unknownCode);
            setUnknownCode(null);
            resume();
            showFlash("warning", "+1", "Hors bon de commande", formatIsbn(unknownCode));
          }}
          onIgnore={() => {
            setUnknownCode(null);
            resume();
          }}
        />
      ) : null}

      {showChecklist ? (
        <Checklist
          onClose={() => {
            setShowChecklist(false);
            resume();
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * Empêche l'écran de s'éteindre pendant le comptage : l'opérateur a les mains
 * prises et ne peut pas rallumer toutes les trente secondes.
 */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Refusé (batterie faible, onglet en arrière-plan) : sans gravité.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !released) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [active]);
}
