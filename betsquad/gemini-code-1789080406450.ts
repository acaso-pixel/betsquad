import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetSquad — La Schedina Collaborativa",
  description: "Crea e vota la schedina con i tuoi amici in tempo reale",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="bg-[#090d14] text-slate-100 antialiased selection:bg-[#00e676] selection:text-black">
        {children}
      </body>
    </html>
  );
}