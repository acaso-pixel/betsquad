"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RoomPage() {
  const params = useParams();
  const rawId = params?.id;
  const roomId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "BS-SESSION";

  const [roomData, setRoomData] = useState<any>(null);
  const [betMode, setBetMode] = useState<"disgiunta" | "congiunta">("disgiunta");
  const [matches, setMatches] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"palinsesto" | "voti" | "schedina" | "comparatore">("palinsesto");
  const [marketFilter, setMarketFilter] = useState<"1X2" | "UO" | "COMBO">("1X2");
  const [stake, setStake] = useState<number>(10);
  const [nick, setNick] = useState("Giocatore");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const isHost = useMemo(() => {
    if (!roomData || !roomData.host_id) return true;
    return roomData.host_id === nick;
  }, [roomData, nick]);

  useEffect(() => {
    const savedNick = localStorage.getItem("bs_nick") || `Player_${Math.random().toString(36).substring(2, 6)}`;
    setNick(savedNick);

    supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRoomData(data);
          if (data.bet_mode) setBetMode(data.bet_mode);
        }
      });

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

    const channelPicks = supabase
      .channel(`room_picks_${roomId}`)
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

    const channelRoom = supabase
      .channel(`room_info_${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.new && payload.new.bet_mode) {
          setBetMode(payload.new.bet_mode);
          showToast(`⚙️ Regole aggiornate: ${payload.new.bet_mode.toUpperCase()}`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channelPicks);
      supabase.removeChannel(channelRoom);
    };
  }, [roomId]);

  const toggleBetMode = async (newMode: "disgiunta" | "congiunta") => {
    if (!isHost) {
      showToast("⛔ Solo chi ha creato la stanza può cambiare le impostazioni!");
      return;
    }
    setBetMode(newMode);
    showToast(`Modalità: ${newMode === "disgiunta" ? "Disgiunta (Libera)" : "Congiunta (Votazioni)"}`);

    try {
      await supabase.from("rooms").update({ bet_mode: newMode }).eq("id", roomId);
    } catch {
      // Ignora l'errore se la colonna non è ancora creata
    }
  };

  // Raggruppamento sicuro e ordinato per date
  const groupedMatches = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    const sorted = [...matches].sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

    sorted.forEach((m) => {
      const d = new Date(m.commence_time);
      const isValid = !isNaN(d.getTime());
      const dateKey = isValid
        ? d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })
        : "Prossimi Turni";
      const capitalized = dateKey.charAt(0).toUpperCase() + dateKey.slice(1);

      if (!groups[capitalized]) groups[capitalized] = [];
      groups[capitalized].push(m);
    });

    return groups;
  }, [matches]);

  const handlePickAction = async (match: any, market: string, selection: string, odds: number) => {
    const existing = picks.find((p) => p.match_id === match.id);

    if (existing && existing.selection === selection) {
      if (betMode === "disgiunta") {
        removePick(existing.id);
        return;
      } else {
        showToast("⚠️ In modalità Congiunta la quota è già in scrutinio/approvata.");
        return;
      }
    }

    if (existing) {
      showToast("⚠️ C'è già un pronostico attivo per questa partita!");
      return;
    }

    const isDirect = betMode === "disgiunta";
    const initialStatus = isDirect ? "confirmed" : "pending";
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
      status: initialStatus,
    };

    setPicks((prev) => [...prev, newPick]);
    showToast(isDirect ? `✅ Inserito in Schedina: ${selection}` : `🗳️ Proposta inviata: ${selection}`);

    const { data, error } = await supabase.from("room_picks").insert({
      room_id: roomId,
      match_id: match.id,
      match_label: newPick.match_label,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: newPick.votes,
      status: initialStatus,
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

    setPicks((prev) => prev.map((p) => (p.id === pick.id ? { ...p, votes: currentVotes, status } : p)));
    await supabase.from("room_picks").update({ votes: currentVotes, status }).eq("id", pick.id);
  };

  const removePick = async (id: string) => {
    setPicks((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("room_picks").delete().eq("id", id);
    showToast("🗑️ Selezione rimossa");
  };

  const confirmed = picks.filter((p) => p.status === "confirmed");
  const pending = picks.filter((p) => p.status === "pending");
  const totalOdds = confirmed.reduce((acc, p) => acc * Number(p.odds), 1).toFixed(2);
  const bonusMultiplier = confirmed.length >= 5 ? 1 + (confirmed.length - 4) * 0.05 : 1.0;
  const potentialWinWithBonus = (stake * Number(totalOdds) * bonusMultiplier).toFixed(2);

  const isSelected = (matchId: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.selection === sel && p.status !== "rejected");
  };

  const copyForWhatsApp = () => {
    const text = `🔥 Schedina BetSquad [${roomId}]\n` +
      `📌 Modalità: ${betMode.toUpperCase()}\n` +
      `📌 Eventi (${confirmed.length}):\n` +
      confirmed.map((c) => `• ${c.match_label}: ${c.selection} @${Number(c.odds).toFixed(2)}`).join("\n") +
      `\n\n💰 Quota Totale: @${totalOdds}` +
      `\n💵 Puntata: ${stake}€` +
      `\n🏆 Vincita Stimata: ${potentialWinWithBonus}€` +
      `\n🔗 Entra nella stanza: ${window.location.href}`;

    navigator.clipboard.writeText(text);
    showToast("📋 Testo copiato per WhatsApp!");
  };

  return (
    <div className="min-h-screen bg-[#0b141f] text-[#e5edf5] pb-28">
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg border border-white/20">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="bg-[#111d2b] border-b border-white/[0.08] sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-[#0084ff] text-white font-black text-xs px-2 py-0.5 rounded tracking-wide">ODDS</span>
            <span className="text-xs font-mono text-neutral-400">ROOM // {roomId}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-300 font-medium">👤 {nick} {isHost && <span className="text-amber-400 text-[10px] font-mono">(HOST)</span>}</span>
            <button
              onClick={copyForWhatsApp}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer"
            >
              Condividi
            </button>
          </div>
        </div>
      </header>

      {/* Switch Modalità Host */}
      <div className="bg-[#162436] border-b border-white/[0.08] px-4 py-2">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 font-bold uppercase text-[10px] tracking-wider">Gestione Quote:</span>
            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
              betMode === "disgiunta" ? "bg-emerald-950/80 text-emerald-400 border border-emerald-500/30" : "bg-amber-950/80 text-amber-400 border border-amber-500/30"
            }`}>
              {betMode === "disgiunta" ? "⚡ DISGIUNTA (Libera)" : "🗳️ CONGIUNTA (Votazione)"}
            </span>
          </div>

          {isHost ? (
            <div className="flex items-center gap-1 bg-[#0b141f] p-0.5 rounded border border-white/[0.1]">
              <button
                onClick={() => toggleBetMode("disgiunta")}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                  betMode === "disgiunta" ? "bg-[#0084ff] text-white" : "text-neutral-400 hover:text-white"
                }`}
              >
                Disgiunta
              </button>
              <button
                onClick={() => toggleBetMode("congiunta")}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                  betMode === "congiunta" ? "bg-[#0084ff] text-white" : "text-neutral-400 hover:text-white"
                }`}
              >
                Congiunta
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-neutral-500 italic">Controllata dall'Host</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <main className="max-w-5xl mx-auto px-3 sm:px-4 pt-4">
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

        {/* Palinsesto */}
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

            {loading ? (
              <div className="bg-[#111d2b] border-x border-b border-white/[0.08] rounded-b-md p-8 text-center text-xs text-neutral-400">
                Sincronizzazione mercati...
              </div>
            ) : Object.keys(groupedMatches).length === 0 ? (
              <div className="bg-[#111d2b] border-x border-b border-white/[0.08] rounded-b-md p-8 text-center text-xs text-neutral-400">
                Nessun match in programma al momento.
              </div>
            ) : (
              <div className="border-x border-b border-white/[0.08] rounded-b-md bg-[#111d2b] overflow-hidden">
                {Object.entries(groupedMatches).map(([dateLabel, matchList]) => (
                  <div key={dateLabel}>
                    <div className="bg-[#18283d] px-4 py-1.5 border-y border-white/[0.08] flex items-center justify-between text-xs font-bold text-neutral-200">
                      <div className="flex items-center gap-2">
                        <span className="text-[#0084ff]">📅</span>
                        <span>{dateLabel}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 w-[180px] sm:w-[220px] text-center text-[10px] text-neutral-400 uppercase">
                        {marketFilter === "1X2" ? (
                          <><span>1</span><span>X</span><span>2</span></>
                        ) : marketFilter === "UO" ? (
                          <><span>Over</span><span>-</span><span>Under</span></>
                        ) : (
                          <><span>1+Ov</span><span>X+Un</span><span>2+Ov</span></>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-white/[0.04]">
                      {matchList.map((m) => {
                        const timeStr = new Date(m.commence_time).toLocaleTimeString("it-IT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div key={m.id} className="px-4 py-2 flex items-center justify-between hover:bg-[#162436]/70 transition">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[11px] font-semibold text-neutral-400 w-10">
                                {timeStr}
                              </span>
                              <div>
                                <div className="text-xs font-bold text-white">{m.home}</div>
                                <div className="text-xs font-bold text-white">{m.away}</div>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 w-[180px] sm:w-[220px]">
                              {marketFilter === "1X2" && (
                                <>
                                  {(["1", "X", "2"] as const).map((lbl) => {
                                    const val = Number(m.odds1X2?.[lbl] || (lbl === "1" ? 2.05 : lbl === "X" ? 3.2 : 3.4));
                                    const selected = isSelected(m.id, lbl);
                                    return (
                                      <button
                                        key={lbl}
                                        onClick={() => handlePickAction(m, "1X2", lbl, val)}
                                        className={`py-1.5 rounded text-center transition cursor-pointer border ${
                                          selected
                                            ? "bg-[#0084ff] border-white text-white shadow-sm"
                                            : "bg-[#1c2c42] hover:bg-[#253954] border-white/[0.08] text-[#f59e0b]"
                                        }`}
                                      >
                                        <span className="block text-xs font-bold font-mono tabular-nums">{val.toFixed(2)}</span>
                                      </button>
                                    );
                                  })}
                                </>
                              )}

                              {marketFilter === "UO" && (
                                <>
                                  <button
                                    onClick={() => handlePickAction(m, "U/O", "Over 2.5", Number(m.derived?.uo?.["Over 2.5"] || 1.85))}
                                    className={`py-1.5 rounded text-center transition cursor-pointer border ${
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
                                    onClick={() => handlePickAction(m, "U/O", "Under 2.5", Number(m.derived?.uo?.["Under 2.5"] || 1.95))}
                                    className={`py-1.5 rounded text-center transition cursor-pointer border ${
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
                                        onClick={() => handlePickAction(m, "Combo", cKey, cVal)}
                                        className={`py-1.5 rounded text-center transition cursor-pointer border ${
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Schedina */}
        {activeTab === "schedina" && (
          <div className="bg-[#111d2b] border border-white/[0.08] rounded p-4">
            <div className="border-b border-white/[0.08] pb-3 mb-4 flex flex-wrap justify-between items-center gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-white">Eventi in Schedina</span>
                <span className="text-xs text-neutral-400 font-mono ml-2">({confirmed.length} match)</span>
              </div>

              <div className="flex items-center gap-1.5 bg-[#0b141f] p-1 rounded border border-white/[0.08]">
                <span className="text-[11px] font-bold text-neutral-400 px-1">Puntata:</span>
                {[2, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    onClick={() => setStake(val)}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer ${
                      stake === val ? "bg-[#0084ff] text-white" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    {val}€
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  value={stake}
                  onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
                  className="w-12 h-6 px-1 text-center bg-[#162436] text-xs font-bold text-white rounded border border-white/[0.1] focus:outline-none"
                />
              </div>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-xs text-neutral-400 py-10 text-center">
                La schedina è vuota. Seleziona le quote dalla tab "Tutte le Quote".
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {confirmed.map((c) => (
                  <div key={c.id} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-white">{c.match_label}</span>
                      <span className="text-[#0084ff] font-bold ml-2">[{c.selection}]</span>
                      <span className="text-[10px] text-neutral-500 block">Autore: {c.proposed_by}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-[#f59e0b] tabular-nums text-sm">@{Number(c.odds).toFixed(2)}</span>
                      <button onClick={() => removePick(c.id)} className="text-neutral-500 hover:text-rose-400 text-xs px-1 cursor-pointer">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-4 mt-3 space-y-2 border-t border-white/[0.1]">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400">Quota Totale Multipla:</span>
                    <span className="font-mono font-bold text-white text-sm">@{totalOdds}</span>
                  </div>

                  {confirmed.length >= 5 && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-amber-400">Bonus Multipla (+{((bonusMultiplier - 1) * 100).toFixed(0)}%):</span>
                      <span className="font-mono font-bold text-amber-400">x{bonusMultiplier.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-baseline pt-2 border-t border-white/[0.08]">
                    <span className="text-xs font-bold uppercase text-neutral-200">
                      Potenziale Vincita ({stake}€)
                    </span>
                    <span className="text-2xl font-mono font-black text-[#10b981] tabular-nums">
                      {potentialWinWithBonus} €
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Voti */}
        {activeTab === "voti" && (
          <div className="space-y-3">
            {pending.length === 0 ? (
              <div className="bg-[#111d2b] border border-white/[0.08] rounded p-8 text-center text-xs text-neutral-400">
                Nessuna giocata in attesa di voto.
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
                        Pronostico: <span className="text-[#0084ff] font-bold">{p.selection}</span> ({p.market}) • da {p.proposed_by}
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

        {/* Comparatore */}
        {activeTab === "comparatore" && (
          <div className="space-y-2">
            <div className="bg-[#162436] border border-white/[0.08] rounded px-4 py-2 text-[11px] font-bold text-neutral-400 uppercase grid grid-cols-12">
              <div className="col-span-5">Bookmaker ADM</div>
              <div className="col-span-4 text-center">Payout Stimato ({stake}€)</div>
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
                  {(stake * Number(totalOdds) * b.bonus * bonusMultiplier).toFixed(2)} €
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

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#111d2b]/95 backdrop-blur-md border-t border-white/[0.1] px-4 py-2.5 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-bold">
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase">Selezioni</span>
              <span className="text-white font-mono">{confirmed.length}</span>
            </div>
            <div className="h-6 w-[1px] bg-white/[0.1]" />
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase">Vincita ({stake}€)</span>
              <span className="text-[#10b981] font-mono text-sm">{potentialWinWithBonus} €</span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("schedina")}
            className="bg-[#0084ff] hover:bg-[#0073e6] text-white font-bold text-xs uppercase tracking-wider px-4 py-2 rounded transition cursor-pointer"
          >
            Vedi Schedina
          </button>
        </div>
      </footer>
    </div>
  );
}