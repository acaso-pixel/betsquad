"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RoomPage() {
  const params = useParams();
  const rawId = params?.id;
  const roomId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "BET-DEMO";

  const [matches, setMatches] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"palinsesto" | "voti" | "schedina" | "comparatore">("palinsesto");
  const [nick, setNick] = useState("Ospite");

  useEffect(() => {
    const savedNick = localStorage.getItem("bs_nick") || `Ospite_${Math.random().toString(36).slice(2, 6)}`;
    setNick(savedNick);

    fetch("/api/odds")
      .then((res) => res.json())
      .then((d) => setMatches(d.matches || []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));

    try {
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
            setPicks((prev) => [...prev, payload.new]);
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
    } catch (e) {
      console.warn("Realtime non collegato, modalita locale");
    }
  }, [roomId]);

  const proposePick = async (match: any, market: string, selection: string, odds: number) => {
    const exists = picks.find((p) => p.match_id === match.id && p.status !== "rejected");
    if (exists) {
      alert("⚠️ Questa partita è già presente in schedina! Rimuovila per cambiarla.");
      return;
    }

    const newPick = {
      room_id: roomId,
      match_id: match.id,
      match_label: `${match.home} vs ${match.away}`,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: { [nick]: 1 },
      status: "pending",
    };

    try {
      const { error } = await supabase.from("room_picks").insert(newPick);
      if (error) throw error;
    } catch {
      setPicks((prev) => [...prev, { ...newPick, id: "local_" + Date.now() }]);
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

    try {
      const { error } = await supabase.from("room_picks").update({ votes: currentVotes, status }).eq("id", pick.id);
      if (error) throw error;
    } catch {
      setPicks((prev) => prev.map((p) => (p.id === pick.id ? { ...p, votes: currentVotes, status } : p)));
    }
  };

  const confirmed = picks.filter((p) => p.status === "confirmed");
  const totalOdds = confirmed.reduce((acc, p) => acc * Number(p.odds), 1).toFixed(2);

  const shareWA = () => {
    const text = `🔥 Entra nella stanza BetSquad!\nQuota attuale: *${totalOdds}* su ${confirmed.length} eventi.\nVota o aggiungi le tue partite qui:\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-[#090d14] text-slate-100 pb-20">
      <header className="sticky top-0 z-30 bg-[#090d14]/90 backdrop-blur border-b border-slate-800 p-4">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-black">⚽ Bet<span className="text-[#00e676]">Squad</span></h1>
            <p className="text-[11px] text-slate-400">Stanza: <b className="text-slate-200">{roomId}</b></p>
          </div>
          <button onClick={shareWA} className="bg-[#25D366] text-[#062b16] font-bold px-3 py-1.5 rounded-lg text-xs">
            💬 WhatsApp
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4">
        <div className="flex gap-2 border-b border-slate-800 pb-2 mb-4 overflow-x-auto">
          {(["palinsesto", "voti", "schedina", "comparatore"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize whitespace-nowrap ${
                activeTab === t ? "bg-[#00e676] text-black" : "bg-[#151f30] text-slate-400"
              }`}
            >
              {t} {t === "schedina" && `(${confirmed.length})`}
            </button>
          ))}
        </div>

        {activeTab === "palinsesto" && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-slate-500 text-center py-10">Caricamento quote reali...</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Nessun match al momento disponibile.</p>
            ) : (
              matches.map((m) => (
                <div key={m.id} className="bg-[#151f30] border border-slate-800 rounded-xl p-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>Serie A</span>
                    <span>{new Date(m.commence_time).toLocaleDateString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="font-bold text-sm mb-3">{m.home} vs {m.away}</div>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(m.odds1X2 || {}).map(([lbl, val]: any) => (
                      <button
                        key={lbl}
                        onClick={() => proposePick(m, "1X2", lbl, Number(val))}
                        className="bg-[#0f1724] border border-slate-800 hover:border-[#00e676] p-2 rounded-lg text-center"
                      >
                        <span className="text-[10px] text-slate-400 block">{lbl}</span>
                        <span className="text-xs font-bold text-[#00e676]">@{Number(val).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-1.5">Combo & Under/Over:</span>
                    <div className="flex gap-2 overflow-x-auto">
                      {Object.entries(m.derived?.combo || {}).slice(0, 3).map(([cName, cVal]: any) => (
                        <button
                          key={cName}
                          onClick={() => proposePick(m, "Combo", cName, Number(cVal))}
                          className="bg-[#0f1724] border border-slate-800 hover:border-[#00e676] px-2.5 py-1.5 rounded-lg whitespace-nowrap text-left"
                        >
                          <span className="text-[10px] text-slate-300 block">{cName}</span>
                          <span className="text-xs font-bold text-[#00e676]">@{cVal}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "voti" && (
          <div className="space-y-3">
            {picks.filter((p) => p.status === "pending").length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Nessuna proposta in attesa di voto.</p>
            ) : (
              picks.filter((p) => p.status === "pending").map((p) => (
                <div key={p.id} className="bg-[#151f30] border border-slate-800 rounded-xl p-4">
                  <div className="flex justify-between font-bold text-xs mb-1">
                    <span>{p.match_label}</span>
                    <span className="text-[#00e676]">@{p.odds}</span>
                  </div>
                  <div className="text-xs text-slate-400 mb-3">{p.selection} (proposta da {p.proposed_by})</div>
                  <div className="flex gap-2">
                    <button onClick={() => votePick(p, 1)} className="bg-[#0f1724] border border-slate-700 px-3 py-1 rounded text-xs">
                      👍 {Object.values(p.votes).filter((v: any) => v > 0).length}
                    </button>
                    <button onClick={() => votePick(p, -1)} className="bg-[#0f1724] border border-slate-700 px-3 py-1 rounded text-xs">
                      👎 {Object.values(p.votes).filter((v: any) => v < 0).length}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "schedina" && (
          <div className="bg-[#151f30] border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold border-b border-slate-800 pb-2">Eventi Confermati dal Gruppo</h3>
            {confirmed.map((c) => (
              <div key={c.id} className="flex justify-between items-center text-xs py-1 border-b border-slate-800/40">
                <span>{c.match_label} — <b>{c.selection}</b></span>
                <span className="text-[#00e676] font-bold">@{c.odds}</span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 text-sm font-bold">
              <span>Quota Totale:</span>
              <span className="text-[#00e676] text-xl">@{totalOdds}</span>
            </div>
          </div>
        )}

        {activeTab === "comparatore" && (
          <div className="space-y-3">
            {[
              { name: "Sisal", aff: "https://www.sisal.it?aff_id=BETSQUAD", bonus: 1.05 },
              { name: "Snai", aff: "https://www.snai.it?aff_id=BETSQUAD", bonus: 1.04 },
              { name: "GoldBet", aff: "https://www.goldbet.it?aff_id=BETSQUAD", bonus: 1.03 },
            ].map((b) => (
              <div key={b.name} className="bg-[#151f30] border border-slate-800 p-4 rounded-xl flex justify-between items-center">
                <div>
                  <div className="font-bold text-sm">{b.name}</div>
                  <div className="text-xs text-slate-400">Vincita su 10€: <b className="text-[#00e676]">{(10 * Number(totalOdds) * b.bonus).toFixed(2)}€</b></div>
                </div>
                <a href={b.aff} target="_blank" rel="noopener" className="bg-[#00e676] text-[#04220f] px-3 py-1.5 rounded-lg text-xs font-bold">
                  Scommetti ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[#0f1724]/95 border-t border-slate-800 p-3 flex justify-between items-center max-w-3xl mx-auto">
        <div className="text-xs text-slate-400">
          Eventi: <b className="text-white">{confirmed.length}</b> | Quota: <b className="text-[#00e676]">@{totalOdds}</b>
        </div>
        <button onClick={() => setActiveTab("schedina")} className="bg-[#00e676] text-black font-bold px-3 py-1.5 rounded-lg text-xs">
          Vedi Schedina
        </button>
      </div>
    </div>
  );
}