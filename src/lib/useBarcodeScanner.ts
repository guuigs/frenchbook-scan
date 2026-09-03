"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { type Decoded, decodeCanvas, warmUpDecoder } from "./decoder";
import { isBookIsbn, normalizeIsbn } from "./isbn";

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
 * 3. Un livre tenu de travers présente un code-barres incliné. Une passe de
 *    lecture 1D tolère ±35°, mesuré ; au-delà il faut présenter l'image
 *    autrement. Le moteur s'en charge en partie (`tryRotate`), et une passe
 *    à 90° faite ici couvre le reste.
 *
 * Le choix du moteur de décodage et des symbologies lues est traité dans
 * `decoder.ts`.
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
  const holdUntilRef = useRef(0);
  const candidateRef = useRef<string | null>(null);

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

  /**
   * Suspend la lecture de **tous** les codes pendant un court instant.
   *
   * L'écartement par code ne suffisait pas. Un livre validé, l'opérateur le
   * retire du champ — et pendant ce geste l'objectif balaie la pile posée à
   * côté, ou attrape de biais un fragment de l'étiquette qui s'en va. Le code
   * lu est alors un *autre* code, que rien n'écartait : la feuille « Absent du
   * bon » s'ouvrait au milieu du mouvement, sur un livre que l'opérateur
   * n'avait jamais présenté.
   *
   * Aucun scan n'est perdu pour autant : la boucle continue de tourner, et un
   * livre présenté pendant la pause est lu dès qu'elle expire.
   */
  const hold = useCallback((ms: number) => {
    holdUntilRef.current = Math.max(holdUntilRef.current, Date.now() + ms);
    candidateRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current as FrameCallbackVideo | null;
    if (!video) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let frameHandle: number | null = null;
    let timeoutHandle: number | null = null;

    // `willReadFrequently` évite à chaque `getImageData` un aller-retour vers
    // le GPU : sur une boucle de lecture, la différence est mesurable.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    /** Reçoit le recadrage pivoté, quand l'orientation du tour l'exige. */
    const turned = document.createElement("canvas");
    const turnedContext = turned.getContext("2d", { willReadFrequently: true });

    /**
     * Le moteur balaie déjà l'image dans les deux sens (`tryRotate`), ce qui
     * couvre jusqu'à 60° d'inclinaison, mesuré. Les deux orientations
     * supplémentaires comblent le reste du demi-tour : la diagonale à 45°, que
     * ni l'horizontale ni la verticale n'attrapent, et la verticale franche.
     */
    const ORIENTATIONS = [0, 90, 45] as const;
    let orientationIndex = 0;
    let inFlight = false;

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

    const attempt = async () => {
      if (stopped || pausedRef.current || !context || inFlight) return;
      // Pendant la pause de repose, on ne décode même pas : c'est autant de
      // batterie économisée sur une image dont on ne veut rien.
      if (Date.now() < holdUntilRef.current) return;

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

      inFlight = true;
      let read: Decoded | null = null;
      try {
        read = await decodeCanvas(target);
      } finally {
        inFlight = false;
      }
      if (stopped || !read) return;

      const code = normalizeIsbn(read.text);
      if (!code) return;

      /*
       * Un Code 128 n'est retenu que s'il est vraiment un ISBN.
       *
       * Cette symbologie est lue parce que certains éditeurs y impriment
       * l'ISBN au lieu d'un EAN-13 (voir `decoder.ts`). Mais c'est aussi la
       * symbologie de tout l'appareillage logistique — étiquette de carton,
       * numéro de colis, code interne du transporteur — dont un entrepôt est
       * couvert. Contrairement à l'EAN-13, qui est par construction un code
       * produit, un Code 128 ne dit rien de ce qu'il transporte : la
       * confirmation sur deux images ne l'écarterait pas, puisqu'une étiquette
       * de carton reste bien lisible d'une image à l'autre.
       *
       * On exige donc le préfixe Bookland et une clé valide. Aucun livre n'est
       * perdu : ces codes-là encodent exactement les treize chiffres de l'ISBN.
       * Et l'opérateur n'est pas dérangé par la feuille « Absent du bon » à
       * chaque fois que l'objectif balaie une palette.
       */
      if (read.format === "Code128" && !isBookIsbn(code)) return;

      const now = Date.now();
      if (now < holdUntilRef.current) return;

      const until = suppressedRef.current.get(code);
      if (until !== undefined && now < until) return;

      /*
       * Un ISBN de livre — préfixe 978/979 et clé valide — est accepté du
       * premier coup : ces deux conditions réunies ne sortent pas du bruit.
       * Tout autre code doit être vu deux images de suite avant d'interrompre
       * l'opérateur. Une étiquette logistique lue de biais pendant que le livre
       * s'éloigne ne survit pas à cette seconde image, et la confirmation coûte
       * quelques dizaines de millisecondes sur un cas de toute façon rare.
       */
      if (!isBookIsbn(code)) {
        if (candidateRef.current !== code) {
          candidateRef.current = code;
          return;
        }
      }

      candidateRef.current = null;
      suppressedRef.current.set(code, now + DEBOUNCE_MS);
      onCodeRef.current(code);
    };

    const loop = () => {
      if (stopped) return;
      void attempt();
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
      // Compile le module de décodage pendant l'ouverture de la caméra.
      warmUpDecoder();
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

  return { status, message, suppress, hold };
}
