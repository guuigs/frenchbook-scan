"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";

type ButtonTone = "primary" | "secondary" | "danger" | "success" | "warning";

const TONE_CLASSES: Record<ButtonTone, string> = {
  primary: "bg-blue-600 text-white active:bg-blue-700 disabled:bg-slate-300",
  secondary: "bg-slate-200 text-blue-700 active:bg-slate-300 disabled:text-slate-400",
  danger: "bg-red-600 text-white active:bg-red-700 disabled:bg-slate-300",
  success: "bg-emerald-600 text-white active:bg-emerald-700 disabled:bg-slate-300",
  warning: "bg-amber-500 text-white active:bg-amber-600 disabled:bg-slate-300",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  block?: boolean;
}

/**
 * Cible tactile de 56 px minimum : l'app est utilisée debout, parfois avec des
 * gants, sans regarder l'écran en continu.
 */
export function Button({ tone = "primary", block = true, className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors select-none ${
        TONE_CLASSES[tone]
      } ${block ? "w-full" : ""} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

type BannerTone = "ok" | "warning" | "danger" | "info";

const BANNER_CLASSES: Record<BannerTone, string> = {
  ok: "bg-emerald-50 text-emerald-900",
  warning: "bg-amber-50 text-amber-900",
  danger: "bg-red-50 text-red-900",
  info: "bg-slate-100 text-slate-700",
};

export function Banner({
  tone,
  title,
  children,
}: {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl p-4 ${BANNER_CLASSES[tone]}`}>
      <p className="text-base font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm opacity-80">{children}</div> : null}
    </div>
  );
}

export function Chip({ children, tone = "warning" }: { children: ReactNode; tone?: BannerTone }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BANNER_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Feuille modale ancrée en bas, à la manière des feuilles iOS. Volontairement
 * non fermable par un geste : chaque feuille de cette app attend une décision
 * explicite, et un balayage accidentel pendant un comptage ferait perdre le
 * livre en cours.
 */
export function Sheet({
  open,
  title,
  children,
  footer,
}: {
  open: boolean;
  title?: ReactNode;
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
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[92dvh] flex-col rounded-t-3xl bg-slate-50 shadow-2xl">
        {title ? (
          <div className="shrink-0 rounded-t-3xl bg-white px-5 pt-3 pb-4 text-center">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" />
            {title}
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5">{children}</div>
        {footer ? (
          <div className="pb-safe shrink-0 border-t border-slate-200 bg-white/90 px-4 pt-3 backdrop-blur">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Barre d'action collée en bas d'un écran plein. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="pb-safe sticky bottom-0 z-10 border-t border-slate-200 bg-white/90 px-4 pt-3 backdrop-blur">
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-2">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function StatRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "warning";
}) {
  const colour =
    tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold tabular-nums ${colour}`}>{value}</span>
    </div>
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
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

  const press = (key: string) => {
    if (key === "C") return onChange(0);
    if (key === "⌫") return onChange(Math.floor(value / 10));
    onChange(Math.min(value * 10 + Number(key), maximum));
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className="min-h-13 rounded-xl bg-white text-xl font-medium shadow-sm active:bg-slate-100"
        >
          {key}
        </button>
      ))}
    </div>
  );
}
