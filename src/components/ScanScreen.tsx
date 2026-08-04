"use client";

import { useEffect, useRef, useState } from "react";

import { useCarton } from "@/lib/store";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import { formatIsbn } from "@/lib/isbn";
import { play, unlockAudio } from "@/lib/feedback";
import {
  displayPublisher,
  expected,
  isComplete,
  progress,
  sessionTitle,
  totalCounted,
  totalExpected,
} from "@/lib/order";
import type { OrderLine } from "@/lib/types";
import { IconCheck, IconChevronRight, IconList } from "./icons";
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
 * Safari n'autorise aucune vibration. La confirmation repose donc sur le son et
 * sur un voile de couleur plein écran, assez large pour être perçu du coin de
 * l'œil sans fixer l'écran.
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
        showFlash("ok", "1/1", outcome.line.title, displayPublisher(outcome.line));
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
          className="pointer-events-none absolute top-1/2 left-1/2 h-36 w-60 -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-white/50"
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

      <footer className="pb-safe relative flex items-center justify-between gap-3 px-3">
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
      </footer>

      {flash ? (
        <div
          key={flash.id}
          aria-live="polite"
          className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-white ${
            flash.tone === "ok" ? "bg-[#0f7b34]/95" : "bg-[#a35200]/95"
          }`}
        >
          <IconCheck className="h-12 w-12" />
          <p className="mt-3 font-mono text-[44px] leading-none font-medium tabular-nums">
            {flash.counter}
          </p>
          <p className="mt-5 line-clamp-2 text-[16px] font-medium">{flash.title}</p>
          <p className="mt-1 truncate text-[13px] text-white/70">{flash.subtitle}</p>
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
            clearDebounce();
            showFlash(
              done ? "ok" : "warning",
              `${count}/${expected(pendingLine)}`,
              pendingLine.title,
              damaged > 0 ? `${damaged} abîmé${damaged > 1 ? "s" : ""}` : "Enregistré",
            );
          }}
          onCancel={() => {
            setPendingLine(null);
            clearDebounce();
          }}
        />
      ) : null}

      {unknownCode ? (
        <UnknownCodeSheet
          code={unknownCode}
          onRecord={() => {
            recordExtra(unknownCode);
            setUnknownCode(null);
            clearDebounce();
            showFlash("warning", "+1", "Hors bon de commande", formatIsbn(unknownCode));
          }}
          onIgnore={() => {
            setUnknownCode(null);
            clearDebounce();
          }}
        />
      ) : null}

      {showChecklist ? (
        <Checklist
          onClose={() => {
            setShowChecklist(false);
            clearDebounce();
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
