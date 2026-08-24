"use client";

import { IconButton } from "./ui";
import { IconBox, IconChevronRight, IconFileSpreadsheet, IconSettings } from "./icons";

function LandingCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[10px] border border-border bg-panel px-4 py-4 text-left active:bg-subtle"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-subtle text-muted">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{subtitle}</span>
      </span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}

export function Landing({
  onStartCarton,
  onClientOrders,
  onOpenSettings,
}: {
  onStartCarton: () => void;
  onClientOrders: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="pt-safe flex items-center justify-between px-4 pb-4">
        <h1 className="text-[22px] font-semibold">Réception</h1>
        <IconButton label="Réglages" onClick={onOpenSettings}>
          <IconSettings />
        </IconButton>
      </header>

      <div className="flex flex-1 flex-col justify-center gap-2 px-4 pb-6">
        <LandingCard
          icon={<IconBox />}
          title="Commencer carton"
          subtitle="Photographier un bon de commande"
          onClick={onStartCarton}
        />
        <LandingCard
          icon={<IconFileSpreadsheet />}
          title="Commande client"
          subtitle="Convertir un export en CSV d'import"
          onClick={onClientOrders}
        />
      </div>
    </main>
  );
}
