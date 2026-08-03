"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

import { normalizeIsbn } from "./isbn";

/**
 * Lecture continue des codes-barres livre.
 *
 * Safari n'implémente pas l'API `BarcodeDetector` du navigateur : on décode
 * avec ZXing, la référence open source du domaine. On restreint les formats
 * aux symbologies du livre — moins de formats à tester, plus d'images
 * analysées par seconde.
 */

export type ScannerStatus = "idle" | "starting" | "running" | "denied" | "error";

/**
 * La caméra voit le même code-barres une vingtaine de fois par seconde tant
 * que le livre est devant l'objectif : sans ce verrou, un exemplaire unique
 * serait compté en rafale.
 */
const DEBOUNCE_MS = 2000;

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  onCode: (code: string) => void;
  /** Suspend la lecture pendant qu'une décision est affichée à l'écran. */
  paused: boolean;
  enabled?: boolean;
}

export function useBarcodeScanner({ videoRef, onCode, paused, enabled = true }: Options) {
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);

  pausedRef.current = paused;
  onCodeRef.current = onCode;

  /** Rouvre immédiatement la lecture d'un code qu'on vient de traiter. */
  const clearDebounce = () => {
    lastCodeRef.current = null;
  };

  useEffect(() => {
    if (!enabled) return;

    const element = videoRef.current;
    if (!element) return;

    let cancelled = false;
    let controls: IScannerControls | undefined;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);

    const reader = new BrowserMultiFormatReader(hints);

    const start = async () => {
      setStatus("starting");
      setMessage(null);
      try {
        const scannerControls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          element,
          (result) => {
            if (!result || pausedRef.current) return;

            const code = normalizeIsbn(result.getText());
            if (!code) return;

            const now = Date.now();
            const last = lastCodeRef.current;
            if (last && last.code === code && now - last.at < DEBOUNCE_MS) return;

            lastCodeRef.current = { code, at: now };
            onCodeRef.current(code);
          },
        );

        if (cancelled) {
          scannerControls.stop();
          return;
        }
        controls = scannerControls;
        setStatus("running");
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMessage(
            "Accès à la caméra refusé. Autorisez-le dans Réglages › Safari, puis rechargez la page.",
          );
        } else if (name === "NotFoundError") {
          setStatus("error");
          setMessage("Aucune caméra détectée sur cet appareil.");
        } else {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "La caméra n'a pas pu démarrer.");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [enabled, videoRef]);

  return { status, message, clearDebounce };
}
