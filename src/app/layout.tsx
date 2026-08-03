import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Réception",
  description: "Contrôle de réception des cartons de livres",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Réception",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // L'app est utilisée debout devant un carton : un zoom accidentel au
  // double-tap pendant un scan est une gêne, pas une fonctionnalité.
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
