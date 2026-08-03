"use client";

import { useEffect, useState } from "react";

import { useCarton } from "@/lib/store";
import { setSoundEnabled as applySoundSetting } from "@/lib/feedback";
import { clearPages } from "@/lib/pages";
import { Button, Card, SectionTitle, Sheet } from "./ui";

export function Settings({ onClose }: { onClose: () => void }) {
  const soundEnabled = useCarton((state) => state.soundEnabled);
  const setSoundEnabled = useCarton((state) => state.setSoundEnabled);
  const loadDemoOrder = useCarton((state) => state.loadDemoOrder);

  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    applySoundSetting(soundEnabled);
  }, [soundEnabled]);

  const signOut = async () => {
    await fetch("/api/session", { method: "DELETE" });
    setSignedOut(true);
    window.location.reload();
  };

  return (
    <Sheet
      open
      title={<h2 className="text-lg font-semibold">Réglages</h2>}
      footer={
        <div className="pb-2">
          <Button onClick={onClose}>Fermer</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <SectionTitle>Poste de scan</SectionTitle>
          <Card>
            <label className="flex items-center justify-between">
              <span className="font-medium">Bips de confirmation</span>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(event) => setSoundEnabled(event.target.checked)}
                className="h-6 w-6 accent-blue-600"
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              Safari sur iOS ne permet aucune vibration : le son est le seul retour non visuel
              disponible. Le désactiver laisse uniquement le voile de couleur plein écran.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Fiabilité de lecture</SectionTitle>
          <Card>
            <p className="text-sm text-slate-600">
              Chaque page est lue par deux moteurs Mistral indépendants, puis les résultats sont
              comparés champ à champ. Les clés de contrôle ISBN sont vérifiées séparément. Ces
              contrôles ne sont pas désactivables.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Données</SectionTitle>
          <Card className="space-y-3">
            <Button
              tone="danger"
              onClick={() => {
                if (confirm("Effacer le carton en cours et ses photos ?")) {
                  void clearPages();
                  void useCarton.getState().abandonCarton();
                  onClose();
                }
              }}
            >
              Effacer le carton en cours
            </Button>
            <p className="text-xs text-slate-500">
              Supprime immédiatement le bon lu, ses photos et le comptage. Sans effet si aucun
              carton n&apos;est ouvert.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Accès</SectionTitle>
          <Card className="space-y-3">
            <Button tone="secondary" disabled={signedOut} onClick={() => void signOut()}>
              Se déconnecter de cet appareil
            </Button>
            <p className="text-xs text-slate-500">
              Le code d&apos;accès sera redemandé au prochain lancement.
            </p>
          </Card>
        </section>

        {process.env.NODE_ENV !== "production" ? (
          <section>
            <SectionTitle>Développement</SectionTitle>
            <Card className="space-y-3">
              <Button
                tone="secondary"
                onClick={() => {
                  loadDemoOrder();
                  onClose();
                }}
              >
                Charger un bon de démonstration
              </Button>
              <p className="text-xs text-slate-500">
                Bon fictif de 7 titres comportant une divergence de lecture, une clé ISBN cassée et
                une ligne à source unique. Permet de dérouler tout le flux sans photo ni appel
                Mistral.
              </p>
            </Card>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
