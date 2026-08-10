"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

import { normalizeIsbn } from "./isbn";

/**
 * Lecture continue des codes-barres livre.
 *
 * Safari n'implémente pas l'API `BarcodeDetector` du navigateur : on décode
 * avec ZXing, la référence open source du domaine.
 *
 * Deux réglages font l'essentiel de la réactivité :
 *
 * - `BrowserMultiFormatOneDReader` au lieu du lecteur multi-format complet. Un
 *   livre ne porte qu'un code-barres linéaire ; inutile de chercher aussi des
 *   QR, DataMatrix, Aztec et PDF417 à chaque image, ce qui représente le gros
 *   du temps de décodage.
 * - `delayBetweenScanAttempts` à 60 ms au lieu des 500 ms par défaut de la
 *   bibliothèque. Par défaut, ZXing ne tente le décodage que deux fois par
 *   seconde : c'est ce qui donnait l'impression que la caméra ne voyait rien.
 */

export type ScannerStatus = "idle" | "starting" | "running" | "denied" | "error";

/** Anti-rebond par défaut : la caméra voit le même code des dizaines de fois. */
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
  const suppressedRef = useRef(new Map<string, number>());

  pausedRef.current = paused;
  onCodeRef.current = onCode;

  /**
   * Ignore un code jusqu'à l'échéance donnée.
   *
   * Indispensable à la fermeture d'une feuille : l'opérateur a encore le livre
   * devant l'objectif, et sans ce délai remis à zéro **au moment où il rend la
   * main**, le même code redéclenche aussitôt la même feuille — l'app paraît
   * bloquée en boucle.
   */
  const suppress = useCallback((code: string, ms: number = DEBOUNCE_MS) => {
    const key = normalizeIsbn(code);
    if (key) suppressedRef.current.set(key, Date.now() + ms);
  }, []);

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

    const reader = new BrowserMultiFormatOneDReader(hints, {
      delayBetweenScanAttempts: 60,
      delayBetweenScanSuccess: 60,
    });

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
            const until = suppressedRef.current.get(code);
            if (until !== undefined && now < until) return;

            suppressedRef.current.set(code, now + DEBOUNCE_MS);
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

  return { status, message, suppress };
}
