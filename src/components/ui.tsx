"use client";

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { useEffect } from "react";

type Variant =
  | "primary"
  | "secondary"
  | "secondaryDanger"
  | "danger"
  | "success"
  | "warning"
  | "ghost";

/**
 * Le bouton primaire Geist inverse simplement le fond et le texte : noir sur
 * blanc en clair, blanc sur noir en sombre. Un seul bouton plein par écran,
 * tout le reste est bordé.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-foreground text-background border-foreground active:opacity-80 disabled:opacity-40",
  secondary:
    "bg-panel text-foreground border-border-strong hover:bg-subtle active:bg-subtle disabled:opacity-40",
  // Action destructrice mais non primaire : le rouge porte sur le texte, pas
  // sur le fond, pour ne pas concurrencer le bouton principal de l'écran.
  secondaryDanger:
    "bg-panel text-danger border-border-strong hover:bg-danger-bg active:bg-danger-bg disabled:opacity-40",
  danger: "bg-danger text-white border-danger active:opacity-85 disabled:opacity-40",
  success: "bg-success text-white border-success active:opacity-85 disabled:opacity-40",
  warning: "bg-warning text-white border-warning active:opacity-85 disabled:opacity-40",
  ghost: "bg-transparent text-muted border-transparent active:text-foreground",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

/** 52 px de haut : l'app se manipule debout, parfois avec des gants. */
export function Button({
  variant = "primary",
  block = true,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-13 items-center justify-center gap-2 rounded-[8px] border px-4 text-[15px] font-medium transition-opacity select-none ${
        VARIANTS[variant]
      } ${block ? "w-full" : ""} ${className}`}
    />
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-border bg-panel ${className}`}>{children}</div>
  );
}

/**
 * Pas d'`outline-none` ici : l'anneau de focus clavier défini globalement reste
 * la seule indication fiable pour qui n'utilise pas la souris.
 */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-12 w-full rounded-[8px] border border-border bg-panel px-3 text-[15px] text-foreground placeholder:text-faint focus:border-border-strong ${className}`}
    />
  );
}

type NoteTone = "success" | "warning" | "danger" | "neutral";

const NOTE_TONES: Record<NoteTone, string> = {
  success: "border-border bg-success-bg text-success",
  warning: "border-border bg-warning-bg text-warning",
  danger: "border-border bg-danger-bg text-danger",
  neutral: "border-border bg-subtle text-muted",
};

/** Une seule ligne, sans explication : le statut, rien de plus. */
export function Note({
  tone,
  children,
  className = "",
  ...props
}: { tone: NoteTone; children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-[8px] border px-3 py-2.5 text-[13px] font-medium ${NOTE_TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

export function Tag({ children, tone = "warning" }: { children: ReactNode; tone?: NoteTone }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${NOTE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="px-0.5 pb-2 text-[13px] font-medium text-muted">{children}</p>;
}

export function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "warning";
}) {
  const colour =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
      <span className="text-[14px] text-muted">{label}</span>
      <span className={`text-[14px] font-medium tabular-nums ${colour}`}>{value}</span>
    </div>
  );
}

/** Barre d'action collée en bas, séparée par un trait plutôt qu'une ombre. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="pb-safe sticky bottom-0 z-10 border-t border-border bg-background/85 px-4 pt-3 backdrop-blur">
      {children}
    </div>
  );
}

/**
 * Feuille modale ancrée en bas. Volontairement non fermable par un geste :
 * chaque feuille attend une décision explicite, et un balayage accidentel
 * pendant un comptage ferait perdre le livre en cours.
 */
export function Sheet({
  open,
  header,
  children,
  footer,
}: {
  open: boolean;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[92dvh] flex-col rounded-t-[14px] border-t border-border bg-background">
        {header ? (
          <div className="shrink-0 border-b border-border px-4 pt-3 pb-4">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border-strong" />
            {header}
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer ? (
          <div className="pb-safe shrink-0 border-t border-border px-4 pt-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Boîte de dialogue centrée pour les décisions irréversibles. */
export function Dialog({
  title,
  body,
  children,
  onDismiss,
}: {
  title: string;
  body?: ReactNode;
  children: ReactNode;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-60 flex items-center justify-center px-5">
      {/* Un vrai bouton plutôt qu'un `div` cliquable : le fond de scène est une
          commande, il doit être atteignable au clavier comme au lecteur d'écran. */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onDismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
      />
      <div className="relative w-full max-w-sm rounded-[12px] border border-border bg-panel p-5">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {body ? <div className="mt-1.5 text-[14px] text-muted">{body}</div> : null}
        <div className="mt-5 space-y-2">{children}</div>
      </div>
    </div>
  );
}

/** Interrupteur Geist : piste pleine quand actif, bordée quand inactif. */
export function Switch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${
        checked ? "border-foreground bg-foreground" : "border-border-strong bg-panel"
      }`}
    >
      <span
        className={`absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full transition-[left] ${
          checked ? "left-[18px] bg-background" : "left-[3px] bg-border-strong"
        }`}
      />
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-panel text-muted active:bg-subtle"
    >
      {children}
    </button>
  );
}

/** Pavé numérique tactile : plus sûr qu'un clavier système avec des gants. */
export function NumberPad({
  value,
  onChange,
  maximum = 999,
}: {
  value: number;
  onChange: (next: number) => void;
  maximum?: number;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"];

  const press = (key: string) => {
    if (key === "C") return onChange(0);
    if (key === "←") return onChange(Math.floor(value / 10));
    onChange(Math.min(value * 10 + Number(key), maximum));
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className="min-h-12 rounded-[8px] border border-border bg-panel text-[17px] font-medium active:bg-subtle"
        >
          {key}
        </button>
      ))}
    </div>
  );
}
