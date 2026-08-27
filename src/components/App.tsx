"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { useCarton } from "@/lib/store";
import { setSoundEnabled } from "@/lib/feedback";
import { Home } from "./Home";
import { LoginGate } from "./LoginGate";
import { Processing } from "./Processing";

/*
 * Les écrans lourds ne sont pas chargés au démarrage.
 *
 * Le décodeur ZXing pèse à lui seul plusieurs centaines de kilooctets et ne
 * sert qu'au poste de scan ; jsPDF, qu'au récapitulatif. Les embarquer dans le
 * bundle initial retardait le premier écran sur le réseau d'un entrepôt.
 */
const OrderReview = dynamic(() => import("./OrderReview").then((m) => m.OrderReview), {
  ssr: false,
});
const ScanScreen = dynamic(() => import("./ScanScreen").then((m) => m.ScanScreen), { ssr: false });
const Summary = dynamic(() => import("./Summary").then((m) => m.Summary), { ssr: false });
const Settings = dynamic(() => import("./Settings").then((m) => m.Settings), { ssr: false });
// Embarque le lecteur de tableur : il n’a rien à faire dans le bundle du
// poste de scan, qui est le seul écran dont le démarrage compte.
const ImportOrder = dynamic(() => import("./ImportOrder").then((m) => m.ImportOrder), {
  ssr: false,
});

type Auth = "checking" | "anonymous" | "authorized";

/**
 * Aiguillage entre les phases du poste de réception.
 *
 * Une phase à l'écran à la fois : l'opérateur ne peut pas scanner pendant qu'il
 * contrôle un bon, ni contrôler pendant qu'il scanne. C'est ce qui rend le
 * comptage traçable.
 */
export function App() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [hydrated, setHydrated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const phase = useCarton((state) => state.phase);
  const soundEnabled = useCarton((state) => state.soundEnabled);

  useEffect(() => {
    let active = true;
    void fetch("/api/session")
      .then((response) => response.json() as Promise<{ authorized?: boolean }>)
      .then((payload) => {
        if (active) setAuth(payload.authorized ? "authorized" : "anonymous");
      })
      .catch(() => {
        if (active) setAuth("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  // L'état est relu depuis IndexedDB de façon asynchrone : rendre avant la fin
  // provoquerait un écart entre le HTML serveur et le premier rendu client.
  useEffect(() => {
    if (useCarton.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useCarton.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  /*
   * Le poste de scan est préchargé dès l'écran de contrôle : quand l'opérateur
   * valide le bon, la caméra doit démarrer sans temps mort. Le module de
   * décodage pèse un mégaoctet et demande une centaine de millisecondes de
   * compilation — autant les dépenser pendant qu'il relit son bon.
   */
  useEffect(() => {
    if (phase === "review") {
      void import("./ScanScreen");
      void import("@/lib/decoder").then((module) => module.warmUpDecoder());
    }
    if (phase === "scanning") void import("./Summary");
  }, [phase]);

  if (auth === "checking" || !hydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-[13px] text-faint">Chargement…</p>
      </main>
    );
  }

  if (auth === "anonymous") {
    return <LoginGate onAuthorized={() => setAuth("authorized")} />;
  }

  return (
    <>
      {phase === "idle" ? <Home onOpenSettings={() => setShowSettings(true)} /> : null}
      {phase === "processing" ? <Processing /> : null}
      {phase === "review" ? <OrderReview /> : null}
      {phase === "scanning" ? <ScanScreen /> : null}
      {phase === "summary" ? <Summary /> : null}

      {showSettings ? (
        <Settings
          onClose={() => setShowSettings(false)}
          onImport={() => {
            setShowSettings(false);
            setShowImport(true);
          }}
        />
      ) : null}
      {showImport ? <ImportOrder onClose={() => setShowImport(false)} /> : null}
    </>
  );
}
