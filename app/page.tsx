"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [nick, setNick] = useState("");
  const [roomName, setRoomName] = useState("");
  const [betMode, setBetMode] = useState<"libera" | "voto">("libera");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedTheme = (localStorage.getItem("bs_theme") as "dark" | "light") || "dark";
    setTheme(savedTheme);
    if (savedTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("bs_theme", next);
    if (next === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    const roomId = "BET-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    const finalNick = nick.trim() || `Player_${Math.floor(1000 + Math.random() * 9000)}`;
    const finalRoomName = roomName.trim() || `Schedina #${roomId}`;
    
    localStorage.setItem("bs_nick", finalNick);

    try {
      await supabase.from("rooms").insert({
        id: roomId,
        name: finalRoomName,
        host_id: finalNick,
        bet_mode: betMode,
      });
    } catch {}

    router.push(`/room/${roomId}`);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] flex flex-col font-sans transition-colors duration-200">
      {/* Top Header */}
      <header className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] px-4 py-3 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Logo BetSquad Ingrandito */}
          <div className="flex items-center gap-2.5">
            <span className="bg-[#0084ff] text-white font-black text-sm px-3 py-1 rounded tracking-wider">BET</span>
            <span className="font-black text-xl tracking-tight">SQUAD</span>
            <span className="text-xs font-mono text-[var(--text-muted)] ml-2 pl-2 border-l border-[var(--border-subtle)] hidden sm:inline">
              Piattaforma Quote & Multipla Sincronizzata
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-xs font-bold hover:border-[#0084ff] transition cursor-pointer"
              title="Cambia tema chiaro/scuro"
            >
              {theme === "dark" ? "☀️ Chiaro" : "🌙 Scuro"}
            </button>
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-emerald-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>LIVE</span>
            </div>
          </div>
        </div>
      </header>

      {/* Sub-bar Sport: NON SELEZIONABILI, Calcio neutro senza sottolineature */}
      <div className="bg-[var(--surface-card)] border-b border-[var(--border-subtle)] px-4 py-2 pointer-events-none select-none">
        <div className="max-w-5xl mx-auto flex items-center gap-6 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <span>⚽ Calcio</span>
          <span>🏀 Basket</span>
          <span>🎾 Tennis</span>
          <span>🏎️ Motori</span>
        </div>
      </div>

      {/* Form Creazione */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl overflow-hidden">
          <div className="bg-[var(--surface-sub)] px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider">Inizializza Stanza Gruppo</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Crea la schedina e invita i partecipanti</p>
            </div>
            <span className="text-base">📋</span>
          </div>

          <form onSubmit={handleCreate} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
                Il Tuo Nickname <span className="text-[11px] font-normal text-[var(--text-muted)] lowercase">(opzionale)</span>
              </label>
              <input
                type="text"
                placeholder="Lascia vuoto per casuale (es. Player_7421)"
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--bg-main)] border border-[var(--border-strong)] rounded text-sm text-[var(--text-main)] focus:outline-none focus:border-[#0084ff] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
                Nome Sessione <span className="text-[11px] font-normal text-[var(--text-muted)] lowercase">(opzionale)</span>
              </label>
              <input
                type="text"
                placeholder="Es. Serie A Sabato Sera"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--bg-main)] border border-[var(--border-strong)] rounded text-sm text-[var(--text-main)] focus:outline-none focus:border-[#0084ff] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
                Regola Inserimento Pronostici
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBetMode("libera")}
                  className={`p-2.5 rounded border text-left transition cursor-pointer ${
                    betMode === "libera"
                      ? "bg-[var(--surface-quote)] border-[#0084ff] shadow-sm"
                      : "bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]"
                  }`}
                >
                  <div className="text-xs font-bold text-emerald-500 flex items-center gap-1">
                    ⚡ Libera
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-1 leading-tight">
                    Tutti aggiungono e tolgono quote subito
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBetMode("voto")}
                  className={`p-2.5 rounded border text-left transition cursor-pointer ${
                    betMode === "voto"
                      ? "bg-[var(--surface-quote)] border-[#0084ff] shadow-sm"
                      : "bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#0084ff] flex items-center gap-1">
                    🗳️ A Voto
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-1 leading-tight">
                    Richiede il voto degli amici per confermare
                  </div>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-3 bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white font-bold text-xs uppercase tracking-wider rounded transition cursor-pointer flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
            >
              {loading ? "Creazione in corso..." : "Crea Stanza & Apri Palinsesto ➔"}
            </button>
          </form>

          <div className="bg-[var(--surface-sub)] px-5 py-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
            <span>CONFRONTO QUOTE ADM</span>
            <span>MULTI-USER REALTIME</span>
          </div>
        </div>
      </main>

      <footer className="bg-[var(--surface-header)] border-t border-[var(--border-subtle)] py-4 text-center text-xs text-[var(--text-muted)]">
        <div className="max-w-5xl mx-auto px-4">
          BetSquad • Piattaforma collaborativa per lo studio e comparazione delle quote sportive.
        </div>
      </footer>
    </div>
  );
}