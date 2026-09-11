import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetSquad - Piattaforma Quote & Multipla Sincronizzata",
  description: "Crea e vota la schedina perfetta con i tuoi amici in tempo reale.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}