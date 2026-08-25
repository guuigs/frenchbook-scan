"use client";

import { useEffect } from "react";

/**
 * Empêche l'écran de s'éteindre tant que l'appel est actif.
 *
 * Deux moments en ont besoin, pour des raisons différentes :
 *
 * — le comptage, où l'opérateur a les mains prises et ne peut pas rallumer
 *   l'écran toutes les trente secondes ;
 *
 * — la lecture du bon, où l'écran veilleux est bien pire qu'une gêne : les
 *   pages partent à l'OCR par requêtes qui durent, et iOS suspend la page dès
 *   qu'elle passe en arrière-plan. Les requêtes en vol tombent alors sans
 *   réponse, ce qui remontait à l'opérateur en « réseau indisponible » alors
 *   que le téléphone n'avait jamais perdu sa connexion.
 */
export function useWakeLock(active: boolean) {
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

    // Le verrou est perdu dès que la page passe en arrière-plan ; il faut le
    // reprendre au retour, sinon il ne vaut que pour le premier plan initial.
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
