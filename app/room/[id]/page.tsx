"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RoomPage() {
  const params = useParams();
  const rawId = params?.id;
  const roomId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "BS-SESSION";

  const [roomData, setRoomData] = useState<any>(null);
  const [betMode, setBetMode] = useState<"libera" | "voto">("libera");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
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
          if (data.bet_mode) {
            const mapped = data.bet_mode === "congiunta" ? "voto" : data.bet_mode === "disgiunta" ? "libera" : data.bet_mode;
            setBetMode(mapped);
          }
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
          const mapped = payload.new.bet_mode === "congiunta" ? "voto" : payload.new.bet_mode === "disgiunta" ? "libera" : payload.new.bet_mode;
          setBetMode(mapped);
          showToast(`⚙️ Regole: ${mapped === "libera" ? "MODIFICA LIBERA" : "MODALITÀ A VOTO"}`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channelPicks);
      supabase.removeChannel(channelRoom);
    };
  }, [roomId]);

  const toggleBetMode = async (newMode: "libera" | "voto") => {
    if (!isHost) {
      showToast("⛔ Solo l'Host può cambiare la modalità!");
      return;
    }
    setBetMode(newMode);
    showToast(`Modalità impostata su: ${newMode === "libera" ? "Libera" : "A Voto"}`);

    try {
      await supabase.from("rooms").update({ bet_mode: newMode }).eq("id", roomId);
    } catch {}
  };

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
      if (betMode === "libera") {
        removePick(existing.id);
        return;
      } else {
        showToast("⚠️ Quota già in votazione/approvata.");
        return;
      }
    }

    if (existing) {
      showToast("⚠️ Esiste già una selezione per questo incontro!");
      return;
    }

    const isDirect = betMode === "libera";
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
    showToast(isDirect ? `✅ Aggiunto: ${selection}` : `🗳️ Proposta inviata: ${selection}`);

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

  // Calcolo Matematico Schedina
  const rawMultiplier = confirmed.reduce((acc, p) => acc * Number(p.odds), 1);
  const totalOdds = confirmed.length > 0 ? (Math.round(rawMultiplier * 100) / 100).toFixed(2) : "0.00";

  const qualifyingEvents = confirmed.filter((p) => Number(p.odds) >= 1.25).length;
  const bonusPct = qualifyingEvents >= 5 ? (qualifyingEvents - 4) * 5 : 0;
  const bonusMultiplier = 1 + bonusPct / 100;

  // Se 0 selezioni la vincita è 0.00
  const baseWin = confirmed.length > 0 ? Number(stake) * Number(totalOdds) : 0;
  const potentialWin = confirmed.length > 0 ? (Math.round(baseWin * bonusMultiplier * 100) / 100).toFixed(2) : "0.00";

  const isSelected = (matchId: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.selection === sel && p.status !== "rejected");
  };

  const copyForWhatsApp = () => {
    const text = `🔥 BetSquad [${roomId}]\n` +
      `⚙️ Regole: ${betMode === "libera" ? "Libera" : "A Voto"}\n` +
      `📌 Pronostici (${confirmed.length}):\n` +
      confirmed.map((c) => `• ${c.match_label}: ${c.selection} @${Number(c.odds).toFixed(2)}`).join("\n") +
      `\n\n💰 Quota Totale: @${totalOdds}` +
      (bonusPct > 0 ? `\n🎁 Bonus Multipla: +${bonusPct}%` : "") +
      `\n💵 Puntata: ${stake}€` +
      `\n🏆 Vincita Potenziale: ${potentialWin}€` +
      `\n🔗 Entra nella stanza: ${window.location.href}`;

    navigator.clipboard.writeText(text);
    showToast("📋 Schedina copiata per WhatsApp!");
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] pb-28 font-sans transition-colors duration-200">
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg border border-white/20">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-[#0084ff] text-white font-black text-xs px-2 py-0.5 rounded tracking-wider">BET</span>
            <span className="font-extrabold text-sm tracking-tight">SQUAD</span>
            <span className="text-[11px] font-mono text-[var(--text-muted)] ml-1 border-l border-[var(--border-subtle)] pl-2">ROOM {roomId}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-xs font-bold hover:border-[#0084ff] transition cursor-pointer"
              title="Cambia tema chiaro/scuro"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <span className="text-xs text-[var(--text-muted)] font-medium">👤 {nick} {isHost && <span className="text-amber-500 text-[10px] font-mono font-bold">(HOST)</span>}</span>
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
      <div className="bg-[var(--surface-card)] border-b border-[var(--border-subtle)] px-4 py-2">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-bold uppercase text-[10px] tracking-wider">Modalità:</span>
            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
              betMode === "libera" ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30" : "bg-amber-500/15 text-amber-500 border border-amber-500/30"
            }`}>
              {betMode === "libera" ? "⚡ LIBERA (Inserimento Diretto)" : "🗳️ A VOTO (Approvazione di Gruppo)"}
            </span>
          </div>

          {isHost ? (
            <div className="flex items-center gap-1 bg-[var(--bg-main)] p-0.5 rounded border border-[var(--border-subtle)]">
              <button
                onClick={() => toggleBetMode("libera")}
                className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                  betMode === "libera" ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                Libera
              </button>
              <button
                onClick={() => toggleBetMode("voto")}
                className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                  betMode === "voto" ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                A Voto
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-[var(--text-muted)] italic">Gestita dall'Host</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <main className="max-w-5xl mx-auto px-3 sm:px-4 pt-4">
        <div className="flex border-b border-[var(--border-subtle)] mb-4 gap-4 text-xs font-bold uppercase tracking-wider overflow-x-auto">
          <button
            onClick={() => setActiveTab("palinsesto")}
            className={`pb-2.5 transition whitespace-nowrap cursor-pointer ${activeTab === "palinsesto" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
          >
            Palinsesto Quote
          </button>
          <button
            onClick={() => setActiveTab("schedina")}
            className={`pb-2.5 flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "schedina" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
          >
            Schedina Squad
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 font-mono">
              {confirmed.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("voti")}
            className={`pb-2.5 flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${activeTab === "voti" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
          >
            Votazioni
            {pending.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-500 border border-amber-500/30 font-mono">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("comparatore")}
            className={`pb-2.5 transition whitespace-nowrap cursor-pointer ${activeTab === "comparatore" ? "text-[#0084ff] border-b-2 border-[#0084ff]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
          >
            Comparatore Bookmaker
          </button>
        </div>

        {/* Tab 1: Palinsesto */}
        {activeTab === "palinsesto" && (
          <div>
            <div className="bg-[var(--surface-header)] border border-[var(--border-subtle)] rounded-t-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">🇮🇹</span>
                <span className="text-xs font-bold uppercase tracking-wider">Serie A TIM</span>
              </div>
              <div className="flex items-center gap-1 bg-[var(--bg-main)] p-0.5 rounded border border-[var(--border-subtle)] text-[11px] font-bold">
                {(["1X2", "UO", "COMBO"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarketFilter(m)}
                    className={`px-2 py-0.5 rounded cursor-pointer transition ${marketFilter === m ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
                  >
                    {m === "UO" ? "Over/Under" : m}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="bg-[var(--surface-header)] border-x border-b border-[var(--border-subtle)] rounded-b-md p-8 text-center text-xs text-[var(--text-muted)]">
                Sincronizzazione lavagne quote...
              </div>
            ) : Object.keys(groupedMatches).length === 0 ? (
              <div className="bg-[var(--surface-header)] border-x border-b border-[var(--border-subtle)] rounded-b-md p-8 text-center text-xs text-[var(--text-muted)]">
                Nessuna partita programmata.
              </div>
            ) : (
              <div className="border-x border-b border-[var(--border-subtle)] rounded-b-md bg-[var(--surface-header)] overflow-hidden">
                {Object.entries(groupedMatches).map(([dateLabel, matchList]) => (
                  <div key={dateLabel}>
                    <div className="bg-[var(--surface-sub)] px-4 py-1.5 border-y border-[var(--border-subtle)] flex items-center justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="text-[#0084ff]">📅</span>
                        <span>{dateLabel}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 w-[180px] sm:w-[220px] text-center text-[10px] text-[var(--text-muted)] uppercase">
                        {marketFilter === "1X2" ? (
                          <><span>1</span><span>X</span><span>2</span></>
                        ) : marketFilter === "UO" ? (
                          <><span>Over</span><span>-</span><span>Under</span></>
                        ) : (
                          <><span>1+Ov</span><span>X+Un</span><span>2+Ov</span></>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-[var(--border-subtle)]">
                      {matchList.map((m) => {
                        const timeStr = new Date(m.commence_time).toLocaleTimeString("it-IT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div key={m.id} className="px-4 py-2 flex items-center justify-between hover:bg-[var(--surface-sub)]/50 transition">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[11px] font-semibold text-[var(--text-muted)] w-10">
                                {timeStr}
                              </span>
                              <div>
                                <div className="text-xs font-bold">{m.home}</div>
                                <div className="text-xs font-bold">{m.away}</div>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 w-[180px] sm:w-[220px]">
                              {marketFilter === "1X2" && (
                                <>
                                  {(["1", "X", "2"] as const).map((lbl) => {
                                    const val = Number(m.odds1X2?.[lbl] || 2.0);
                                    const selected = isSelected(m.id, lbl);
                                    return (
                                      <button
                                        key={lbl}
                                        onClick={() => handlePickAction(m, "1X2", lbl, val)}
                                        className={`py-1.5 rounded text-center transition cursor-pointer border ${
                                          selected
                                            ? "bg-[#0084ff] border-white text-white shadow-sm"
                                            : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
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
                                        : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                    }`}
                                  >
                                    <span className="block text-xs font-bold font-mono tabular-nums">
                                      {m.derived?.uo?.["Over 2.5"]?.toFixed(2) || "1.85"}
                                    </span>
                                  </button>
                                  <div className="flex items-center justify-center text-[var(--text-muted)] text-xs font-bold">-</div>
                                  <button
                                    onClick={() => handlePickAction(m, "U/O", "Under 2.5", Number(m.derived?.uo?.["Under 2.5"] || 1.95))}
                                    className={`py-1.5 rounded text-center transition cursor-pointer border ${
                                      isSelected(m.id, "Under 2.5")
                                        ? "bg-[#0084ff] border-white text-white"
                                        : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                    }`}
                                  >
                                    <span className="block text-xs font-bold font-mono tabular-nums">
                                      {m.derived?.uo?.["Under 2.5"]?.toFixed(2) || "1.95"}
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
                                            : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
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

        {/* Tab 2: Schedina */}
        {activeTab === "schedina" && (
          <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded p-4 shadow-sm">
            <div className="border-b border-[var(--border-subtle)] pb-3 mb-4 flex flex-wrap justify-between items-center gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider">Schedina BetSquad</span>
                <span className="text-xs text-[var(--text-muted)] font-mono ml-2">({confirmed.length} eventi)</span>
              </div>

              <div className="flex items-center gap-1.5 bg-[var(--bg-main)] p-1 rounded border border-[var(--border-subtle)]">
                <span className="text-[11px] font-bold text-[var(--text-muted)] px-1">Puntata:</span>
                {[2, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    onClick={() => setStake(val)}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer ${
                      stake === val ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
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
                  className="w-12 h-6 px-1 text-center bg-[var(--surface-sub)] text-xs font-bold rounded border border-[var(--border-subtle)] focus:outline-none"
                />
              </div>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] py-10 text-center">
                Nessun evento in schedina. Tocca le quote nel palinsesto per iniziare.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {confirmed.map((c) => (
                  <div key={c.id} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold">{c.match_label}</span>
                      <span className="text-[#0084ff] font-bold ml-2">[{c.selection}]</span>
                      <span className="text-[10px] text-[var(--text-muted)] block">Autore: {c.proposed_by}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-[var(--quote-val)] tabular-nums text-sm">@{Number(c.odds).toFixed(2)}</span>
                      <button onClick={() => removePick(c.id)} className="text-[var(--text-muted)] hover:text-rose-500 text-xs px-1 cursor-pointer">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-4 mt-3 space-y-2 border-t border-[var(--border-subtle)]">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--text-muted)]">Quota Moltiplicatore:</span>
                    <span className="font-mono font-bold text-sm">@{totalOdds}</span>
                  </div>

                  {bonusPct > 0 && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-amber-500 font-medium">Bonus Multipla ADM (+{bonusPct}%):</span>
                      <span className="font-mono font-bold text-amber-500">+{((Number(potentialWin) - baseWin)).toFixed(2)} €</span>
                    </div>
                  )}

                  <div className="flex justify-between items-baseline pt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-xs font-bold uppercase text-[var(--text-muted)]">
                      Potenziale Vincita ({stake}€)
                    </span>
                    <span className="text-2xl font-mono font-black text-emerald-500 tabular-nums">
                      {potentialWin} €
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Voti */}
        {activeTab === "voti" && (
          <div className="space-y-3">
            {pending.length === 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded p-8 text-center text-xs text-[var(--text-muted)]">
                Nessuna proposta in attesa di scrutinio.
              </div>
            ) : (
              pending.map((p) => {
                const up = Object.values(p.votes || {}).filter((v: any) => v > 0).length;
                const down = Object.values(p.votes || {}).filter((v: any) => v < 0).length;
                return (
                  <div key={p.id} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded p-3 flex items-center justify-between shadow-sm">
                    <div>
                      <div className="text-xs font-bold">{p.match_label}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Pronostico: <span className="text-[#0084ff] font-bold">{p.selection}</span> ({p.market}) • da {p.proposed_by}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-[var(--quote-val)] tabular-nums">@{Number(p.odds).toFixed(2)}</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => votePick(p, 1)}
                          className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                            p.votes?.[nick] === 1 ? "bg-emerald-600 text-white" : "bg-[var(--surface-quote)] text-[var(--text-main)] hover:border-[#0084ff]"
                          }`}
                        >
                          👍 {up}
                        </button>
                        <button
                          onClick={() => votePick(p, -1)}
                          className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                            p.votes?.[nick] === -1 ? "bg-rose-600 text-white" : "bg-[var(--surface-quote)] text-[var(--text-main)] hover:border-[#0084ff]"
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

        {/* Tab 4: Comparatore */}
        {activeTab === "comparatore" && (
          <div className="space-y-2">
            <div className="bg-[var(--surface-sub)] border border-[var(--border-subtle)] rounded px-4 py-2 text-[11px] font-bold text-[var(--text-muted)] uppercase grid grid-cols-12">
              <div className="col-span-5">Bookmaker ADM</div>
              <div className="col-span-4 text-center">Payout Stimato ({stake}€)</div>
              <div className="col-span-3 text-right">Azione</div>
            </div>

            {[
              { name: "Sisal.it", bonus: 1.05, link: "https://www.sisal.it" },
              { name: "Snai.it", bonus: 1.04, link: "https://www.snai.it" },
              { name: "GoldBet", bonus: 1.03, link: "https://www.goldbet.it" },
            ].map((b) => (
              <div key={b.name} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:border-[#0084ff] rounded px-4 py-3 grid grid-cols-12 items-center transition shadow-sm">
                <div className="col-span-5 font-bold text-xs">{b.name}</div>
                <div className="col-span-4 text-center font-mono font-bold text-xs text-emerald-500 tabular-nums">
                  {(Number(potentialWin) * b.bonus).toFixed(2)} €
                </div>
                <div className="col-span-3 text-right">
                  <a
                    href={b.link}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#0084ff] hover:bg-[#0073e6] text-white font-bold text-[11px] px-3 py-1.5 rounded transition uppercase tracking-wider inline-block"
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
      <footer className="fixed bottom-0 left-0 right-0 bg-[var(--surface-header)]/95 backdrop-blur-md border-t border-[var(--border-subtle)] px-4 py-2.5 z-40 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-bold">
            <div>
              <span className="text-[var(--text-muted)] block text-[10px] uppercase">Selezioni</span>
              <span className="font-mono">{confirmed.length}</span>
            </div>
            <div className="h-6 w-[1px] bg-[var(--border-subtle)]" />
            <div>
              <span className="text-[var(--text-muted)] block text-[10px] uppercase">Vincita ({stake}€)</span>
              <span className="text-emerald-500 font-mono text-sm">{potentialWin} €</span>
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