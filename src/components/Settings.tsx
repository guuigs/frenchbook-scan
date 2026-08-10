"use client";

import { useEffect } from "react";

import { useCarton } from "@/lib/store";
import { setSoundEnabled as applySoundSetting } from "@/lib/feedback";
import { Button, Label, Sheet, Switch } from "./ui";

export function Settings({ onClose }: { onClose: () => void }) {
  const soundEnabled = useCarton((state) => state.soundEnabled);
  const setSoundEnabled = useCarton((state) => state.setSoundEnabled);
  const abandonCarton = useCarton((state) => state.abandonCarton);
  const loadDemoOrder = useCarton((state) => state.loadDemoOrder);

  useEffect(() => {
    applySoundSetting(soundEnabled);
  }, [soundEnabled]);

  return (
    <Sheet
      open
      onDismiss={onClose}
      header={<h2 className="text-[15px] font-medium">Réglages</h2>}
      footer={
        <div className="pb-3">
          <Button onClick={onClose}>Fermer</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <section>
          <Label>Scan</Label>
          <div className="flex items-center justify-between rounded-[10px] border border-border px-4 py-3">
            <label htmlFor="sound" className="text-[14px]">
              Bips de confirmation
            </label>
            <Switch id="sound" checked={soundEnabled} onChange={setSoundEnabled} />
          </div>
        </section>

        <section>
          <Label>Données</Label>
          <Button
            variant="secondaryDanger"
            onClick={() => {
              void abandonCarton();
              onClose();
            }}
          >
            Effacer le carton en cours
          </Button>
        </section>

        <section>
          <Label>Accès</Label>
          <Button
            variant="secondary"
            onClick={() => {
              void fetch("/api/session", { method: "DELETE" }).then(() => window.location.reload());
            }}
          >
            Se déconnecter
          </Button>
        </section>

        {/* Opt-in explicite plutôt qu'un test sur NODE_ENV : permet d'activer la
            démonstration sur un déploiement de préversion Vercel sans qu'elle
            n'atteigne jamais la production. */}
        {process.env.NEXT_PUBLIC_ENABLE_DEMO === "1" ? (
          <section>
            <Label>Développement</Label>
            <Button
              variant="secondary"
              onClick={() => {
                loadDemoOrder();
                onClose();
              }}
            >
              Charger un bon de démonstration
            </Button>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
