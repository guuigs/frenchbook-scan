"use client";

import { useEffect, useState } from "react";

import { useCarton } from "@/lib/store";
import { setSoundEnabled } from "@/lib/feedback";
import { Home } from "./Home";
import { LoginGate } from "./LoginGate";
import { OrderReview } from "./OrderReview";
import { Processing } from "./Processing";
import { ScanScreen } from "./ScanScreen";
import { Settings } from "./Settings";
import { Summary } from "./Summary";

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

  if (auth === "checking" || !hydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-slate-400">Chargement…</p>
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

      {showSettings ? <Settings onClose={() => setShowSettings(false)} /> : null}
    </>
  );
}
