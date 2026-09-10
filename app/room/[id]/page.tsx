"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RoomPage() {
  const params = useParams();
  const rawId = params?.id;
  const roomId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "BS-SESSION";

  const [matches, setMatches] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"palinsesto" | "voti" | "schedina" | "comparatore">("palinsesto");
  const [marketFilter, setMarketFilter] = useState<"1X2" | "UO" | "COMBO">("1X2");
  const [nick, setNick] = useState("Giocatore");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const savedNick = localStorage.getItem("bs_nick") || `Player_${Math.random().toString(36).substring(2, 6)}`;
    setNick(savedNick);

    fetch("/api/odds")
      .then((res) => res.json())
      .then((d) => setMatches(d.matches || []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));

    supabase
      .from("room_picks")
      .select("*")
      .eq("room_id", roomId)
      .then(({ data }) => {
        if (data) setPicks(data);
      });

    const channel = supabase
      .channel(`room_${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_picks", filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          setPicks((prev) => (prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new]));
        } else if (payload.eventType === "UPDATE") {
          setPicks((prev) => prev.map((p) => (p.id === payload.new.id ? payload.new : p)));
        } else if (payload.eventType === "DELETE") {
          setPicks((prev) => prev.filter((p) => p.id === payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const proposePick = async (match: any, market: string, selection: string, odds: number) => {
    const existing = picks.find((p) => p.match_id === match.id);
    if (existing) {
      showToast(`⚠️ Evento già in ${existing.status === "confirmed" ? "schedina" : "votazione"}!`);
      return;
    }

    const tempId = `pick_${Date.now()}`;
    const newPick = {
      id: tempId,
      room_id: roomId,
      match_id: match.id,
      match_label: `${match.home} - ${match.away}`,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: { [nick]: 1 },
      status: "confirmed", // Confermato subito per chi testa in singolo
    };

    // Aggiornamento ottimistico immediato
    setPicks((prev) => [...prev, newPick]);
    showToast(`✅ ${selection} aggiunto alla schedina!`);

    const { data, error } = await supabase.from("room_picks").insert({
      room_id: roomId,
      match_id: match.id,
      match_label: newPick.match_label,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: newPick.votes,
      status: "confirmed",
    }).select().single();

    if (data && !error) {
      setPicks((prev) => prev.map((p) => (p.id === tempId ? data : p)));
    }
  };

  const votePick = async (pick: any, val: number) => {
    const currentVotes = { ...pick.votes };
    currentVotes[nick] = currentVotes[nick] === val ? 0 : val;
    if (currentVotes[nick] === 0) delete currentVotes[nick];

    const up = Object.values(currentVotes).filter((v) => (v as number) > 0).length;
    const down = Object.values(currentVotes).filter((v) => (v as number) < 0).length;
    let status = pick.status;
    if (up >= 2 && up > down) status = "confirmed";
    if (down >= 2 && down > up) status = "rejected";

    // Aggiornamento locale immediato
    setPicks((prev) => prev.map((p) => (p.id === pick.id ? { ...p, votes: currentVotes, status } : p)));

    await supabase.from("room_picks").update({ votes: currentVotes, status }).eq("id", pick.id);
  };

  const removePick = async (id: string) => {
    setPicks((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("room_picks").delete().eq("id", id);
    showToast("🗑️ Quota rimossa");
  };

  const confirmed = picks.filter((p) => p.status === "confirmed");
  const pending = picks.filter((p) => p.status === "pending");
  const totalOdds = confirmed.reduce((acc, p) => acc * Number(p.odds), 1).toFixed(2);

  const isSelected = (matchId: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.selection === sel && p.status !== "rejected");
  };

  const shareLink = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: "Oddspedia Squad", url });
    } else {
      navigator.clipboard.writeText(url);
      showToast("📋 Link copiato negli appunti!");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b141f] text-[#e5edf5] pb-24">
      {/* Toast Alert Flottante */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg border border-white/20 animate-fade-in">
          {toast}
        </div>
      )}

      {/* Top Bar Header */}
      <header className="bg-[#111d2b] border-b border-white/[0.08] sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-[#0084ff] text-white font-black text-xs px-2 py-0.5 rounded tracking-wide">ODDS</span>
            <span className="text-xs font-mono text-neutral-400">ROOM // {roomId}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-300 font-medium">👤 {nick}</span>
            <button
              onClick={shareLink}
              className="bg-[#162436] border border-white/[0.12] hover:border-[#0084ff] text-xs font-semibold px-2.5 py-1 rounded transition cursor-pointer"
            >
              Condividi
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-3 sm:px-4 pt-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-white/[0.1] mb-4 gap-4 text-xs font-bold uppercase tracking-wider overflow-x-auto">
          <button
            onClick={() => setActiveTab("palinsesto")}
            className={`pb-2.5 transition whitespace-nowrap cursor-pointer ${activeTab === "palinsesto" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-neutral-400 hover:text-white"}`}
          >
            Tutte le Quote
          </button>
          <button
            onClick={() => setActiveTab("schedina")}
            className={`pb-2.5 flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "schedina" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-neutral-400 hover:text-white"}`}
          >
            Schedina Squad
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
              {confirmed.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("voti")}
            className={`pb-2.5 flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "voti" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-neutral-400 hover:text-white"}`}
          >
            Votazioni
            {pending.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("comparatore")}
            className={`pb-2.5 transition whitespace-nowrap cursor-pointer ${activeTab === "comparatore" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-neutral-400 hover:text-white"}`}
          >
            Comparatore Bookmaker
          </button>
        </div>

        {/* Tab 1: PALINSESTO */}
        {activeTab === "palinsesto" && (
          <div>
            <div className="bg-[#111d2b] border border-white/[0.08] rounded-t-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">🇮🇹</span>
                <span className="text-xs font-bold uppercase tracking-wider text-white">Italia: Serie A</span>
              </div>
              <div className="flex items-center gap-1 bg-[#0b141f] p-0.5 rounded border border-white/[0.08] text-[11px] font-bold">
                {(["1X2", "UO", "COMBO"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarketFilter(m)}
                    className={`px-2 py-0.5 rounded cursor-pointer transition ${marketFilter === m ? "bg-[#0084ff] text-white" : "text-neutral-400 hover:text-white"}`}
                  >
                    {m === "UO" ? "Over/Under" : m}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-[#162436] border-x border-white/[0.08] px-4 py-1.5 grid grid-cols-12 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
              <div className="col-span-6 sm:col-span-7">Partita & Data</div>
              <div className="col-span-6 sm:col-span-5 grid grid-cols-3 text-center">
                {marketFilter === "1X2" ? (
                  <><span>1</span><span>X</span><span>2</span></>
                ) : marketFilter === "UO" ? (
                  <><span>Over 2.5</span><span>-</span><span>Under 2.5</span></>
                ) : (
                  <><span>1 + Ov</span><span>X + Un</span><span>2 + Ov</span></>
                )}
              </div>
            </div>

            <div className="border border-white/[0.08] rounded-b-md divide-y divide-white/[0.05] bg-[#111d2b]">
              {loading ? (
                <div className="p-8 text-center text-xs text-neutral-400">Caricamento quote in tempo reale...</div>
              ) : matches.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-400">Nessun match al momento programmato.</div>
              ) : (
                matches.map((m) => (
                  <div key={m.id} className="px-4 py-2.5 grid grid-cols-12 items-center hover:bg-[#162436]/60 transition">
                    <div className="col-span-6 sm:col-span-7 pr-2">
                      <div className="text-[10px] font-mono text-neutral-400 mb-0.5">
                        {new Date(m.commence_time).toLocaleDateString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-xs font-bold text-white leading-tight">{m.home}</div>
                      <div className="text-xs font-bold text-white leading-tight">{m.away}</div>
                    </div>

                    <div className="col-span-6 sm:col-span-5 grid grid-cols-3 gap-1.5">
                      {marketFilter === "1X2" && (
                        <>
                          {(["1", "X", "2"] as const).map((lbl) => {
                            const val = Number(m.odds1X2?.[lbl] || (lbl === "1" ? 2.05 : lbl === "X" ? 3.2 : 3.4));
                            const selected = isSelected(m.id, lbl);
                            return (
                              <button
                                key={lbl}
                                onClick={() => proposePick(m, "1X2", lbl, val)}
                                className={`py-2 rounded text-center transition cursor-pointer border ${
                                  selected
                                    ? "bg-[#0084ff] border-white text-white shadow-md"
                                    : "bg-[#1c2c42] hover:bg-[#253954] border-white/[0.08] text-[#f59e0b]"
                                }`}
                              >
                                <span className="block text-xs font-bold font-mono tabular-nums">
                                  {val.toFixed(2)}
                                </span>
                              </button>
                            );
                          })}
                        </>
                      )}

                      {marketFilter === "UO" && (
                        <>
                          <button
                            onClick={() => proposePick(m, "U/O", "Over 2.5", Number(m.derived?.uo?.["Over 2.5"] || 1.85))}
                            className={`py-2 rounded text-center transition cursor-pointer border ${
                              isSelected(m.id, "Over 2.5")
                                ? "bg-[#0084ff] border-white text-white"
                                : "bg-[#1c2c42] hover:bg-[#253954] border-white/[0.08] text-[#f59e0b]"
                            }`}
                          >
                            <span className="block text-xs font-bold font-mono tabular-nums">
                              {m.derived?.uo?.["Over 2.5"] || "1.85"}
                            </span>
                          </button>
                          <div className="flex items-center justify-center text-neutral-600 text-xs font-bold">-</div>
                          <button
                            onClick={() => proposePick(m, "U/O", "Under 2.5", Number(m.derived?.uo?.["Under 2.5"] || 1.95))}
                            className={`py-2 rounded text-center transition cursor-pointer border ${
                              isSelected(m.id, "Under 2.5")
                                ? "bg-[#0084ff] border-white text-white"
                                : "bg-[#1c2c42] hover:bg-[#253954] border-white/[0.08] text-[#f59e0b]"
                            }`}
                          >
                            <span className="block text-xs font-bold font-mono tabular-nums">
                              {m.derived?.uo?.["Under 2.5"] || "1.95"}
                            </span>
                          </button>
                        </>
                      )}

                      {marketFilter === "COMBO" && (
                        <>
                          {(["1 + Over 2.5", "X + Under 2.5", "2 + Over 2.5"] as const).map((cKey) => {
                            const cVal = Number(m.derived?.combo?.[cKey] || 3.5);
                            const selected = isSelected(m.id, cKey);
                            return (
                              <button
                                key={cKey}
                                onClick={() => proposePick(m, "Combo", cKey, cVal)}
                                className={`py-2 rounded text-center transition cursor-pointer border ${
                                  selected
                                    ? "bg-[#0084ff] border-white text-white"
                                    : "bg-[#1c2c42] hover:bg-[#253954] border-white/[0.08] text-[#f59e0b]"
                                }`}
                              >
                                <span className="block text-xs font-bold font-mono tabular-nums">{cVal.toFixed(2)}</span>
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: SCHEDINA SQUAD */}
        {activeTab === "schedina" && (
          <div className="bg-[#111d2b] border border-white/[0.08] rounded p-4">
            <div className="border-b border-white/[0.08] pb-2 mb-3 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-white">Eventi in Schedina</span>
              <span className="text-xs text-neutral-400 font-mono">{confirmed.length} selezionati</span>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-xs text-neutral-400 py-8 text-center">
                La schedina è ancora vuota. Clicca sulle quote nel palinsesto per aggiungerle.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {confirmed.map((c) => (
                  <div key={c.id} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-white">{c.match_label}</span>
                      <span className="text-[#0084ff] font-bold ml-2">[{c.selection}]</span>
                      <span className="text-[10px] text-neutral-500 block">Proposto da: {c.proposed_by}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-[#f59e0b] tabular-nums text-sm">@{Number(c.odds).toFixed(2)}</span>
                      <button onClick={() => removePick(c.id)} className="text-neutral-500 hover:text-rose-400 text-xs px-1 cursor-pointer">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div className="pt-4 mt-2 flex justify-between items-baseline font-bold">
                  <span className="text-xs uppercase text-neutral-300">Quota Totale Schedina</span>
                  <span className="text-xl font-mono text-[#10b981] tabular-nums">@{totalOdds}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: VOTAZIONI */}
        {activeTab === "voti" && (
          <div className="space-y-3">
            {pending.length === 0 ? (
              <div className="bg-[#111d2b] border border-white/[0.08] rounded p-8 text-center text-xs text-neutral-400">
                Nessuna proposta in attesa di voto. Tutte le giocate confermate sono visibili in "Schedina Squad".
              </div>
            ) : (
              pending.map((p) => {
                const up = Object.values(p.votes || {}).filter((v: any) => v > 0).length;
                const down = Object.values(p.votes || {}).filter((v: any) => v < 0).length;
                return (
                  <div key={p.id} className="bg-[#111d2b] border border-white/[0.08] rounded p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">{p.match_label}</div>
                      <div className="text-[11px] text-neutral-400">
                        Pronostico: <span className="text-[#0084ff] font-bold">{p.selection}</span> ({p.market})
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-[#f59e0b] tabular-nums">@{Number(p.odds).toFixed(2)}</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => votePick(p, 1)}
                          className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                            p.votes?.[nick] === 1 ? "bg-[#10b981] text-white" : "bg-[#162436] text-neutral-300 hover:bg-[#22354c]"
                          }`}
                        >
                          👍 {up}
                        </button>
                        <button
                          onClick={() => votePick(p, -1)}
                          className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                            p.votes?.[nick] === -1 ? "bg-rose-600 text-white" : "bg-[#162436] text-neutral-300 hover:bg-[#22354c]"
                          }`}
                        >
                          👎 {down}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 4: COMPARATORE */}
        {activeTab === "comparatore" && (
          <div className="space-y-2">
            <div className="bg-[#162436] border border-white/[0.08] rounded px-4 py-2 text-[11px] font-bold text-neutral-400 uppercase grid grid-cols-12">
              <div className="col-span-5">Operatore ADM</div>
              <div className="col-span-4 text-center">Vincita su 10€</div>
              <div className="col-span-3 text-right">Azione</div>
            </div>

            {[
              { name: "Sisal.it", bonus: 1.05, link: "https://www.sisal.it" },
              { name: "Snai.it", bonus: 1.04, link: "https://www.snai.it" },
              { name: "GoldBet", bonus: 1.03, link: "https://www.goldbet.it" },
            ].map((b) => (
              <div key={b.name} className="bg-[#111d2b] border border-white/[0.08] hover:border-[#0084ff] rounded px-4 py-3 grid grid-cols-12 items-center transition">
                <div className="col-span-5 font-bold text-xs text-white">{b.name}</div>
                <div className="col-span-4 text-center font-mono font-bold text-xs text-[#10b981] tabular-nums">
                  {(10 * Number(totalOdds) * b.bonus).toFixed(2)} €
                </div>
                <div className="col-span-3 text-right">
                  <a
                    href={b.link}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#0084ff] hover:bg-[#0073e6] text-white font-bold text-[11px] px-3 py-1.5 rounded transition uppercase tracking-wider"
                  >
                    Scommetti ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer Fisso */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#111d2b]/95 backdrop-blur-md border-t border-white/[0.1] px-4 py-2.5 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-bold">
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase">Selezioni</span>
              <span className="text-white font-mono">{confirmed.length}</span>
            </div>
            <div className="h-6 w-[1px] bg-white/[0.1]" />
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase">Quota Totale</span>
              <span className="text-[#10b981] font-mono text-sm">@{totalOdds}</span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("schedina")}
            className="bg-[#0084ff] hover:bg-[#0073e6] text-white font-bold text-xs uppercase tracking-wider px-4 py-2 rounded transition cursor-pointer"
          >
            Vedi Schedina ({confirmed.length})
          </button>
        </div>
      </footer>
    </div>
  );
}