"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { HTMLCanvasElementLuminanceSource } from "@zxing/browser";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatOneDReader,
} from "@zxing/library";

import { normalizeIsbn } from "./isbn";

/**
 * Lecture continue des codes-barres livre.
 *
 * Safari n'implémente pas `BarcodeDetector` : le décodage se fait en JavaScript
 * avec ZXing. La boucle de capture est écrite ici plutôt que déléguée à
 * `@zxing/browser`, pour trois raisons établies à la mesure :
 *
 * 1. Le décodage n'a jamais été le goulot — 0,4 ms par image. C'est la capture
 *    qui coûte : lire une image 1280×720 et la convertir en niveaux de gris
 *    demande ~15 ms sur une machine de bureau, davantage sur un téléphone.
 *    En ne capturant que la bande visée, on tombe sous 2 ms.
 * 2. `@zxing/browser` attend 500 ms entre deux tentatives et analyse tout le
 *    cadre. Le viseur affiché à l'écran n'avait donc aucun effet : viser ne
 *    servait à rien.
 * 3. Un livre tenu de travers présente un code-barres vertical, que ZXing ne
 *    lit jamais. Sa rotation interne, censée couvrir ce cas, est inopérante :
 *    mesurée, elle échoue toujours. On pivote donc le recadrage soi-même, ce
 *    qui le fait lire en 0,8 ms.
 *
 * `TRY_HARDER` est délibérément absent. Mesuré sur la bande visée : il fait
 * passer l'image sans code — le cas de loin le plus fréquent — de 25 ms à
 * 222 ms, sans rien lire de plus.
 *
 * Les deux orientations sont essayées en alternance, une par image. Le coût par
 * image reste celui d'un seul décodage, et un code est vu au pire à la seconde
 * image, soit moins de 70 ms après être entré dans le viseur.
 *
 * Le décodage est cadencé par `requestVideoFrameCallback` : une tentative par
 * image réellement produite par la caméra, ni plus ni moins.
 */

export type ScannerStatus = "idle" | "starting" | "running" | "denied" | "error";

/**
 * Zone visée, en fraction de la surface visible. La même constante sert au
 * cadre dessiné à l'écran et au recadrage envoyé au décodeur : ce que
 * l'opérateur vise est exactement ce qui est analysé.
 */
export const SCAN_REGION = { width: 0.92, height: 0.34 };

/** Plafond de la largeur analysée : au-delà, on paie sans mieux lire. */
const MAX_DECODE_WIDTH = 720;

const DEBOUNCE_MS = 2000;

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  onCode: (code: string) => void;
  paused: boolean;
  enabled?: boolean;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

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
   * devant l'objectif, et sans ce délai remis à zéro au moment où il rend la
   * main, le même code redéclenche aussitôt la même feuille.
   */
  const suppress = useCallback((code: string, ms: number = DEBOUNCE_MS) => {
    const key = normalizeIsbn(code);
    if (key) suppressedRef.current.set(key, Date.now() + ms);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current as FrameCallbackVideo | null;
    if (!video) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let frameHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);
    const reader = new MultiFormatOneDReader(hints);

    // `willReadFrequently` évite à chaque `getImageData` un aller-retour vers
    // le GPU : sur une boucle de lecture, la différence est mesurable.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    /** Reçoit le recadrage pivoté, quand l'orientation du tour l'exige. */
    const turned = document.createElement("canvas");
    const turnedContext = turned.getContext("2d", { willReadFrequently: true });

    /**
     * Un code-barres 1D se lit par balayage de lignes horizontales. Une passe
     * tolère donc l'inclinaison tant qu'une ligne traverse les 95 modules sans
     * sortir de la hauteur des barres : mesuré à ±35° sur un EAN de livre.
     * Trois orientations couvrent le demi-tour complet sans angle mort, la
     * diagonale comprise — c'est le seul angle qu'aucune des deux autres
     * n'attrape.
     */
    const ORIENTATIONS = [0, 90, 45] as const;
    let orientationIndex = 0;

    /**
     * La vidéo est affichée en `object-cover` : une partie du cadre déborde de
     * l'écran. On calcule la zone visée dans les coordonnées de la source, pour
     * que le viseur affiché et la zone décodée coïncident exactement.
     */
    const captureRegion = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const ew = video.clientWidth || vw;
      const eh = video.clientHeight || vh;
      if (!vw || !vh) return null;

      const scale = Math.max(ew / vw, eh / vh);
      const visibleW = ew / scale;
      const visibleH = eh / scale;

      const sw = visibleW * SCAN_REGION.width;
      const sh = visibleH * SCAN_REGION.height;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      const ratio = Math.min(1, MAX_DECODE_WIDTH / sw);
      return {
        sx,
        sy,
        sw,
        sh,
        dw: Math.max(1, Math.round(sw * ratio)),
        dh: Math.max(1, Math.round(sh * ratio)),
      };
    };

    const attempt = () => {
      if (stopped || pausedRef.current || !context) return;

      const region = captureRegion();
      if (!region) return;

      if (canvas.width !== region.dw || canvas.height !== region.dh) {
        canvas.width = region.dw;
        canvas.height = region.dh;
      }

      context.drawImage(
        video,
        region.sx,
        region.sy,
        region.sw,
        region.sh,
        0,
        0,
        region.dw,
        region.dh,
      );

      // Une seule orientation par image, à tour de rôle : le coût par image
      // reste celui d'un unique décodage, et un code entré dans le viseur est
      // vu au pire trois images plus tard, soit moins de 100 ms.
      const angle = ORIENTATIONS[orientationIndex];
      orientationIndex = (orientationIndex + 1) % ORIENTATIONS.length;

      let target = canvas;
      if (angle !== 0 && turnedContext) {
        if (angle === 90) {
          if (turned.width !== region.dh || turned.height !== region.dw) {
            turned.width = region.dh;
            turned.height = region.dw;
          }
          // Transformation en nombres entiers. Un `translate` au centre tombe
          // sur des demi-pixels dès qu'une dimension est impaire, ce qui
          // déclenche un rééchantillonnage bilinéaire : des modules de 2 px se
          // brouillent alors au point de devenir illisibles.
          turnedContext.setTransform(0, 1, -1, 0, turned.width, 0);
          turnedContext.drawImage(canvas, 0, 0);
        } else {
          const side = Math.ceil(Math.hypot(region.dw, region.dh));
          if (turned.width !== side || turned.height !== side) {
            turned.width = side;
            turned.height = side;
          }
          turnedContext.setTransform(1, 0, 0, 1, 0, 0);
          turnedContext.fillStyle = "#ffffff";
          turnedContext.fillRect(0, 0, side, side);
          turnedContext.translate(side / 2, side / 2);
          turnedContext.rotate((angle * Math.PI) / 180);
          turnedContext.drawImage(canvas, -region.dw / 2, -region.dh / 2);
        }
        turnedContext.setTransform(1, 0, 0, 1, 0, 0);
        target = turned;
      }

      let text: string | null = null;
      try {
        const source = new HTMLCanvasElementLuminanceSource(target);
        text = reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
      } catch {
        // Aucun code lisible sur cette image : le cas courant, pas une erreur.
        return;
      }

      const code = normalizeIsbn(text ?? "");
      if (!code) return;

      const now = Date.now();
      const until = suppressedRef.current.get(code);
      if (until !== undefined && now < until) return;

      suppressedRef.current.set(code, now + DEBOUNCE_MS);
      onCodeRef.current(code);
    };

    const loop = () => {
      if (stopped) return;
      attempt();
      schedule();
    };

    const schedule = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        frameHandle = video.requestVideoFrameCallback(loop);
      } else {
        timeoutHandle = window.setTimeout(loop, 60);
      }
    };

    const start = async () => {
      setStatus("starting");
      setMessage(null);
      try {
        // En portrait, `object-cover` ne laisse voir qu'une bande verticale du
        // cadre paysage de la caméra : demander 1080 plutôt que 720 augmente
        // d'autant la résolution réellement disponible sur le code-barres.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => undefined);

        setStatus("running");
        schedule();
      } catch (error) {
        if (stopped) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMessage(
            "Accès à la caméra refusé. Autorisez-le dans Réglages › Safari, puis rechargez la page.",
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setMessage("Aucune caméra utilisable sur cet appareil.");
        } else {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "La caméra n'a pas pu démarrer.");
        }
      }
    };

    void start();

    return () => {
      stopped = true;
      if (frameHandle !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [enabled, videoRef]);

  return { status, message, suppress };
}
