"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
  const [participantsCount, setParticipantsCount] = useState<number>(4);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [nick, setNick] = useState("Giocatore");
  const [toast, setToast] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    const channel = supabase.channel(`room_${roomId}`, {
      config: { presence: { key: savedNick } }
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users = Object.keys(state);
        setOnlineUsers(users);
        if (users.length > 0) {
          setParticipantsCount((prev) => Math.max(prev, users.length));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_picks", filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          setPicks((prev) => (prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new]));
        } else if (payload.eventType === "UPDATE") {
          setPicks((prev) => prev.map((p) => (p.id === payload.new.id ? payload.new : p)));
        } else if (payload.eventType === "DELETE") {
          setPicks((prev) => prev.filter((p) => p.id === payload.old.id));
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.new && payload.new.bet_mode) {
          const mapped = payload.new.bet_mode === "congiunta" ? "voto" : payload.new.bet_mode === "disgiunta" ? "libera" : payload.new.bet_mode;
          setBetMode(mapped);
          showToast(`⚙️ Regole: ${mapped === "libera" ? "MODIFICA LIBERA" : "MODALITÀ A VOTO"}`);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
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
        ? d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })
        : "Prossimi";
      const capitalized = dateKey.toUpperCase();

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
        showToast("⚠️ Quota già registrata.");
        return;
      }
    }

    if (existing) {
      showToast("⚠️ C'è già un pronostico su questa gara!");
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
      reactions: {},
      status: initialStatus,
    };

    setPicks((prev) => [...prev, newPick]);
    showToast(isDirect ? `✅ Aggiunta: ${selection}` : `🗳️ Proposta: ${selection}`);

    const { data, error } = await supabase.from("room_picks").insert({
      room_id: roomId,
      match_id: match.id,
      match_label: newPick.match_label,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: newPick.votes,
      reactions: {},
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

  const reactPick = async (pick: any, emoji: string) => {
    const currentReactions = { ...(pick.reactions || {}) };
    const currentList: string[] = currentReactions[emoji] || [];
    const exists = currentList.includes(nick);

    currentReactions[emoji] = exists
      ? currentList.filter((n) => n !== nick)
      : [...currentList, nick];

    if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

    setPicks((prev) => prev.map((p) => (p.id === pick.id ? { ...p, reactions: currentReactions } : p)));
    try {
      await supabase.from("room_picks").update({ reactions: currentReactions }).eq("id", pick.id);
    } catch {}
  };

  const removePick = async (id: string) => {
    setPicks((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("room_picks").delete().eq("id", id);
    showToast("🗑️ Quota rimossa");
  };

  const confirmed = picks.filter((p) => p.status === "confirmed");
  const pending = picks.filter((p) => p.status === "pending");

  const rawMultiplier = confirmed.reduce((acc, p) => acc * Number(p.odds), 1);
  const totalOdds = confirmed.length > 0 ? (Math.round(rawMultiplier * 100) / 100).toFixed(2) : "0.00";

  const qualifyingEvents = confirmed.filter((p) => Number(p.odds) >= 1.25).length;
  const bonusPct = qualifyingEvents >= 5 ? (qualifyingEvents - 4) * 5 : 0;
  const bonusMultiplier = 1 + bonusPct / 100;

  const baseWin = confirmed.length > 0 ? Number(stake) * Number(totalOdds) : 0;
  const potentialWin = confirmed.length > 0 ? (Math.round(baseWin * bonusMultiplier * 100) / 100).toFixed(2) : "0.00";

  const safeParticipants = Math.max(1, participantsCount);
  const stakePerHead = (stake / safeParticipants).toFixed(2);
  const winPerHead = (Number(potentialWin) / safeParticipants).toFixed(2);

  const isSelected = (matchId: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.selection === sel && p.status !== "rejected");
  };

  const copyForWhatsApp = () => {
    const text = `🔥 BetSquad [${roomId}]\n` +
      `⚙️ Regole: ${betMode === "libera" ? "Libera" : "A Voto"}\n` +
      `👥 Partecipanti: ${safeParticipants} (${stakePerHead}€ a testa)\n` +
      `📌 Pronostici (${confirmed.length}):\n` +
      confirmed.map((c) => `• ${c.match_label}: ${c.selection} @${Number(c.odds).toFixed(2)}`).join("\n") +
      `\n\n💰 Quota Totale: @${totalOdds}` +
      (bonusPct > 0 ? `\n🎁 Bonus Multipla: +${bonusPct}%` : "") +
      `\n💵 Puntata: ${stake}€ (Vincita a testa: ${winPerHead}€)` +
      `\n🏆 Vincita Totale: ${potentialWin}€` +
      `\n🔗 Entra nella stanza: ${window.location.href}`;

    navigator.clipboard.writeText(text);
    showToast("📋 Schedina copiata per WhatsApp!");
  };

  // Helper disegno rettangoli arrotondati compatibile 100% universale
  const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  };

  const exportStoryCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 1080;
    canvas.height = 1920;

    // Gradient di sfondo
    const grad = ctx.createLinearGradient(0, 0, 0, 1920);
    grad.addColorStop(0, "#0b141f");
    grad.addColorStop(0.5, "#111d2b");
    grad.addColorStop(1, "#070b11");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    // Header Badge BetSquad
    ctx.fillStyle = "#0084ff";
    drawRoundedRect(ctx, 80, 100, 240, 70, 16);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 36px sans-serif";
    ctx.fillText("BETSQUAD", 98, 148);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 30px monospace";
    ctx.fillText(`ROOM // ${roomId}`, 350, 148);

    // Titolo
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px sans-serif";
    ctx.fillText("MULTIPLA DELLA SQUAD", 80, 260);

    // Card Match
    ctx.fillStyle = "rgba(22, 36, 54, 0.85)";
    drawRoundedRect(ctx, 80, 310, 920, 980, 24);

    let yPos = 390;
    if (confirmed.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "italic 36px sans-serif";
      ctx.fillText("Nessun pronostico approvato", 140, yPos);
    } else {
      confirmed.slice(0, 8).forEach((c, idx) => {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 32px sans-serif";
        ctx.fillText(`${idx + 1}. ${c.match_label}`, 120, yPos);

        ctx.fillStyle = "#0084ff";
        ctx.font = "bold 30px sans-serif";
        ctx.fillText(`Pronostico: ${c.selection}`, 120, yPos + 42);

        ctx.fillStyle = "#f59e0b";
        ctx.font = "900 36px monospace";
        ctx.fillText(`@${Number(c.odds).toFixed(2)}`, 850, yPos + 25);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(120, yPos + 75);
        ctx.lineTo(960, yPos + 75);
        ctx.stroke();

        yPos += 115;
      });
    }

    // Box Totali
    ctx.fillStyle = "#162436";
    drawRoundedRect(ctx, 80, 1330, 920, 420, 24);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("QUOTA TOTALE", 130, 1410);
    ctx.fillText("PARTECIPANTI", 600, 1410);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 52px monospace";
    ctx.fillText(`@${totalOdds}`, 130, 1480);
    ctx.fillText(`${safeParticipants} (${stakePerHead}€ cad.)`, 600, 1480);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(`POTENZIALE VINCITA (${stake}€):`, 130, 1580);

    ctx.font = "900 84px monospace";
    ctx.fillText(`${potentialWin} €`, 130, 1680);

    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 36px monospace";
    ctx.fillText(`➜ ${winPerHead} € a testa`, 550, 1670);

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `BetSquad-${roomId}.png`;
    link.href = dataUrl;
    link.click();
    showToast("📸 Card Storia scaricata!");
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] pb-28 font-sans antialiased select-none">
      <canvas ref={canvasRef} className="hidden" />

      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg border border-white/20">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] sticky top-0 z-30 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="bg-[#0084ff] text-white font-black text-[10px] px-1.5 py-0.5 rounded">BET</span>
          <span className="font-extrabold text-xs tracking-tight">SQUAD</span>
          <span className="text-[10px] font-mono text-[var(--text-muted)] ml-1 border-l border-[var(--border-subtle)] pl-1.5">{roomId}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={exportStoryCard}
            className="p-1.5 rounded bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-xs font-bold hover:border-[#0084ff] transition cursor-pointer"
            title="Scarica Card per Instagram Stories"
          >
            📸
          </button>
          <button
            onClick={toggleTheme}
            className="w-7 h-7 flex items-center justify-center rounded bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-xs cursor-pointer"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            onClick={copyForWhatsApp}
            className="bg-emerald-600 active:bg-emerald-700 text-white text-[11px] font-bold px-2 py-1 rounded flex items-center gap-1 cursor-pointer"
          >
            Invia
          </button>
        </div>
      </header>

      {/* Barra Presenze Online & Modalità */}
      <div className="bg-[var(--surface-card)] border-b border-[var(--border-subtle)] px-3 py-1.5 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 truncate pr-2">
          <span className="text-[var(--text-muted)] truncate">👤 {nick}</span>
          {isHost && <span className="bg-amber-500/20 text-amber-500 text-[9px] font-bold px-1 rounded">HOST</span>}
          {onlineUsers.length > 0 && (
            <span className="text-emerald-500 font-mono text-[10px] flex items-center gap-1 border-l border-[var(--border-subtle)] pl-2">
              🟢 {onlineUsers.length} online
            </span>
          )}
        </div>

        {isHost ? (
          <div className="flex items-center gap-0.5 bg-[var(--bg-main)] p-0.5 rounded border border-[var(--border-subtle)] shrink-0">
            <button
              onClick={() => toggleBetMode("libera")}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                betMode === "libera" ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"
              }`}
            >
              Libera
            </button>
            <button
              onClick={() => toggleBetMode("voto")}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                betMode === "voto" ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"
              }`}
            >
              A Voto
            </button>
          </div>
        ) : (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            betMode === "libera" ? "text-emerald-500 bg-emerald-500/10" : "text-amber-500 bg-amber-500/10"
          }`}>
            {betMode === "libera" ? "⚡ Libera" : "🗳️ A Voto"}
          </span>
        )}
      </div>

      {/* Tabs Reordinate: Palinsesto -> Votazioni -> Schedina Squad -> Comparatore */}
      <div className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] px-2 flex text-xs font-bold uppercase tracking-wider overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab("palinsesto")}
          className={`py-2 px-3 transition whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "palinsesto" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Palinsesto Quote
        </button>
        <button
          onClick={() => setActiveTab("voti")}
          className={`py-2 px-3 flex items-center gap-1 whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "voti" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Votazioni
          {pending.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-amber-500/20 text-amber-500 font-mono">
              {pending.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("schedina")}
          className={`py-2 px-3 flex items-center gap-1 whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "schedina" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Schedina Squad
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-500 font-mono">
            {confirmed.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("comparatore")}
          className={`py-2 px-3 whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "comparatore" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Comparatore Bookmaker
        </button>
      </div>

      <main className="p-2 sm:p-4 max-w-4xl mx-auto">
        {/* Tab 1: Palinsesto */}
        {activeTab === "palinsesto" && (
          <div>
            <div className="flex items-center justify-between pb-2">
              <div className="text-[11px] font-bold text-[var(--text-muted)]">🇮🇹 Serie A TIM</div>
              <div className="flex bg-[var(--surface-card)] p-0.5 rounded border border-[var(--border-subtle)] text-[10px] font-bold">
                {(["1X2", "UO", "COMBO"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarketFilter(m)}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      marketFilter === m ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12 text-xs text-[var(--text-muted)]">Caricamento quote...</div>
            ) : Object.keys(groupedMatches).length === 0 ? (
              <div className="text-center py-12 text-xs text-[var(--text-muted)]">Nessuna partita programmata.</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedMatches).map(([dateLabel, matchList]) => (
                  <div key={dateLabel} className="bg-[var(--surface-header)] border border-[var(--border-subtle)] rounded-lg overflow-hidden shadow-sm">
                    <div className="bg-[var(--surface-sub)] px-3 py-1 text-[11px] font-bold flex items-center justify-between border-b border-[var(--border-subtle)]">
                      <span>📅 {dateLabel}</span>
                      <span className="text-[9px] text-[var(--text-muted)] font-mono uppercase">
                        {marketFilter === "1X2" ? "1 • X • 2" : marketFilter === "UO" ? "Over • Under" : "Combo"}
                      </span>
                    </div>

                    <div className="divide-y divide-[var(--border-subtle)]">
                      {matchList.map((m) => {
                        const timeStr = new Date(m.commence_time).toLocaleTimeString("it-IT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div key={m.id} className="p-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 pr-1">
                              <span className="text-[10px] font-mono text-[var(--text-muted)] block mb-0.5">{timeStr}</span>
                              <div className="text-xs font-bold leading-tight truncate">{m.home}</div>
                              <div className="text-xs font-bold leading-tight truncate">{m.away}</div>
                            </div>

                            <div className="grid grid-cols-3 gap-1 shrink-0 w-[160px] sm:w-[200px]">
                              {marketFilter === "1X2" && (
                                <>
                                  {(["1", "X", "2"] as const).map((lbl) => {
                                    const val = Number(m.odds1X2?.[lbl] || 2.0);
                                    const selected = isSelected(m.id, lbl);
                                    return (
                                      <button
                                        key={lbl}
                                        onClick={() => handlePickAction(m, "1X2", lbl, val)}
                                        className={`h-9 flex flex-col items-center justify-center rounded transition border cursor-pointer ${
                                          selected
                                            ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                            : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                        }`}
                                      >
                                        <span className="text-[9px] text-[var(--text-muted)] leading-none -mt-0.5">{lbl}</span>
                                        <span className="text-xs font-bold font-mono tabular-nums leading-tight">
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
                                    onClick={() => handlePickAction(m, "U/O", "Over 2.5", Number(m.derived?.uo?.["Over 2.5"] || 1.85))}
                                    className={`h-9 flex flex-col items-center justify-center rounded transition border cursor-pointer ${
                                      isSelected(m.id, "Over 2.5")
                                        ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                        : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                    }`}
                                  >
                                    <span className="text-[8px] text-[var(--text-muted)] leading-none">O 2.5</span>
                                    <span className="text-xs font-bold font-mono tabular-nums leading-tight">
                                      {m.derived?.uo?.["Over 2.5"]?.toFixed(2) || "1.85"}
                                    </span>
                                  </button>
                                  <div className="h-9 flex items-center justify-center text-[var(--text-muted)] text-[10px]">-</div>
                                  <button
                                    onClick={() => handlePickAction(m, "U/O", "Under 2.5", Number(m.derived?.uo?.["Under 2.5"] || 1.95))}
                                    className={`h-9 flex flex-col items-center justify-center rounded transition border cursor-pointer ${
                                      isSelected(m.id, "Under 2.5")
                                        ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                        : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                    }`}
                                  >
                                    <span className="text-[8px] text-[var(--text-muted)] leading-none">U 2.5</span>
                                    <span className="text-xs font-bold font-mono tabular-nums leading-tight">
                                      {m.derived?.uo?.["Under 2.5"]?.toFixed(2) || "1.95"}
                                    </span>
                                  </button>
                                </>
                              )}

                              {marketFilter === "COMBO" && (
                                <>
                                  {(["1 + Over 2.5", "X + Under 2.5", "2 + Over 2.5"] as const).map((cKey, idx) => {
                                    const cVal = Number(m.derived?.combo?.[cKey] || 3.5);
                                    const selected = isSelected(m.id, cKey);
                                    const shortLbl = idx === 0 ? "1+Ov" : idx === 1 ? "X+Un" : "2+Ov";
                                    return (
                                      <button
                                        key={cKey}
                                        onClick={() => handlePickAction(m, "Combo", cKey, cVal)}
                                        className={`h-9 flex flex-col items-center justify-center rounded transition border cursor-pointer ${
                                          selected
                                            ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                            : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                        }`}
                                      >
                                        <span className="text-[8px] text-[var(--text-muted)] leading-none">{shortLbl}</span>
                                        <span className="text-xs font-bold font-mono tabular-nums leading-tight">
                                          {cVal.toFixed(2)}
                                        </span>
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

        {/* Tab 2: Votazioni (Con Reaction Rapide) */}
        {activeTab === "voti" && (
          <div className="space-y-2">
            {pending.length === 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-8 text-center text-xs text-[var(--text-muted)]">
                Nessuna proposta in attesa di voto.
              </div>
            ) : (
              pending.map((p) => {
                const up = Object.values(p.votes || {}).filter((v: any) => v > 0).length;
                const down = Object.values(p.votes || {}).filter((v: any) => v < 0).length;

                return (
                  <div key={p.id} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="pr-2 truncate">
                        <div className="text-xs font-bold truncate">{p.match_label}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          <span className="text-[#0084ff] font-bold">{p.selection}</span> ({p.market}) da {p.proposed_by}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-[var(--quote-val)] text-sm">@{Number(p.odds).toFixed(2)}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => votePick(p, 1)}
                            className={`px-2 py-1 rounded text-xs font-bold cursor-pointer ${
                              p.votes?.[nick] === 1 ? "bg-emerald-600 text-white" : "bg-[var(--surface-quote)]"
                            }`}
                          >
                            👍 {up}
                          </button>
                          <button
                            onClick={() => votePick(p, -1)}
                            className={`px-2 py-1 rounded text-xs font-bold cursor-pointer ${
                              p.votes?.[nick] === -1 ? "bg-rose-600 text-white" : "bg-[var(--surface-quote)]"
                            }`}
                          >
                            👎 {down}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Barra Reaction Emoji Rapide */}
                    <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--border-subtle)] text-xs">
                      <span className="text-[10px] text-[var(--text-muted)]">Reagisci:</span>
                      {["🔥", "💣", "🔒", "🤡"].map((emoji) => {
                        const count = (p.reactions?.[emoji] || []).length;
                        const hasReacted = (p.reactions?.[emoji] || []).includes(nick);
                        return (
                          <button
                            key={emoji}
                            onClick={() => reactPick(p, emoji)}
                            className={`px-1.5 py-0.5 rounded border text-[11px] transition cursor-pointer ${
                              hasReacted
                                ? "bg-[#0084ff]/20 border-[#0084ff] text-white"
                                : "bg-[var(--surface-quote)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-white/20"
                            }`}
                          >
                            {emoji} {count > 0 && <span className="font-mono font-bold ml-0.5">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 3: Schedina Squad (Con Calcolatore a Testa) */}
        {activeTab === "schedina" && (
          <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-3">
              <span className="text-xs font-bold uppercase">Schedina ({confirmed.length})</span>
              <div className="flex items-center gap-1 bg-[var(--bg-main)] p-1 rounded border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)]">Puntata:</span>
                {[2, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    onClick={() => setStake(val)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                      stake === val ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {val}€
                  </button>
                ))}
              </div>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-center py-8 text-xs text-[var(--text-muted)]">
                Nessuna giocata in schedina. Tocca le quote nel palinsesto per aggiungerle.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {confirmed.map((c) => (
                  <div key={c.id} className="py-2 flex items-center justify-between text-xs">
                    <div className="pr-2 truncate">
                      <div className="font-bold truncate">{c.match_label}</div>
                      <div className="text-[11px] text-[#0084ff] font-semibold">{c.selection}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-[var(--quote-val)] text-sm">@{Number(c.odds).toFixed(2)}</span>
                      <button onClick={() => removePick(c.id)} className="text-rose-500 px-1 text-sm cursor-pointer">✕</button>
                    </div>
                  </div>
                ))}

                <div className="pt-3 mt-2 border-t border-[var(--border-subtle)] space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Quota moltiplicatore:</span>
                    <span className="font-mono font-bold">@{totalOdds}</span>
                  </div>
                  {bonusPct > 0 && (
                    <div className="flex justify-between text-amber-500">
                      <span>Bonus ADM (+{bonusPct}%):</span>
                      <span className="font-mono font-bold">+{((Number(potentialWin) - baseWin)).toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline pt-2 border-t border-[var(--border-subtle)]">
                    <span className="font-bold uppercase text-xs">Potenziale Vincita ({stake}€):</span>
                    <span className="text-xl font-mono font-black text-emerald-500">{potentialWin} €</span>
                  </div>

                  {/* Divisione Spesa e Vincita a Testa */}
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] bg-[var(--surface-sub)] p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase">Partecipanti alla spesa:</span>
                      <select
                        value={participantsCount}
                        onChange={(e) => setParticipantsCount(Number(e.target.value))}
                        className="bg-[var(--bg-main)] text-xs font-bold border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-main)] cursor-pointer"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map((num) => (
                          <option key={num} value={num}>
                            {num} {num === 1 ? "persona" : "persone"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center pt-1">
                      <div className="bg-[var(--surface-card)] p-2 rounded border border-[var(--border-subtle)]">
                        <span className="block text-[10px] text-[var(--text-muted)] uppercase">Quota a testa</span>
                        <span className="text-xs font-mono font-bold text-amber-500">{stakePerHead} €</span>
                      </div>
                      <div className="bg-[var(--surface-card)] p-2 rounded border border-[var(--border-subtle)]">
                        <span className="block text-[10px] text-[var(--text-muted)] uppercase">Vincita a testa</span>
                        <span className="text-xs font-mono font-bold text-emerald-500">{winPerHead} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Comparatore */}
        {activeTab === "comparatore" && (
          <div className="space-y-1.5">
            {[
              { name: "Sisal.it", bonus: 1.05, link: "https://www.sisal.it" },
              { name: "Snai.it", bonus: 1.04, link: "https://www.snai.it" },
              { name: "GoldBet", bonus: 1.03, link: "https://www.goldbet.it" },
            ].map((b) => (
              <div key={b.name} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-2.5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold">{b.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Bonus incluso</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-emerald-500">
                    {(Number(potentialWin) * b.bonus).toFixed(2)} €
                  </div>
                  <a
                    href={b.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[9px] uppercase font-bold text-[#0084ff]"
                  >
                    Apri ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Schedina a Scomparsa (Drawer a Tendina Stile NovaJackpot) */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-xs z-50 transition-opacity duration-300 ${
          isSheetOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsSheetOpen(false)}
      >
        <div
          className={`absolute bottom-0 left-0 right-0 max-w-xl mx-auto bg-[var(--surface-card)] border-t border-[var(--border-strong)] rounded-t-2xl shadow-2xl p-4 transition-transform duration-300 max-h-[85vh] overflow-y-auto pb-16 ${
            isSheetOpen ? "translate-y-0" : "translate-y-full"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Maniglia Touch */}
          <div className="w-12 h-1.5 bg-[var(--border-strong)] rounded-full mx-auto mb-3 cursor-pointer" onClick={() => setIsSheetOpen(false)} />

          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
            <span className="text-sm font-bold uppercase tracking-wider">Schedina Squad ({confirmed.length})</span>
            <button onClick={() => setIsSheetOpen(false)} className="text-xs font-bold text-[var(--text-muted)] hover:text-white p-1 cursor-pointer">
              Chiudi ▼
            </button>
          </div>

          {/* Contenuto Schedina Tendina */}
          {confirmed.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              Nessun evento ancora selezionato.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] py-2">
              {confirmed.map((c) => (
                <div key={c.id} className="py-2 flex items-center justify-between text-xs">
                  <div className="pr-2 truncate">
                    <div className="font-bold truncate">{c.match_label}</div>
                    <div className="text-[11px] text-[#0084ff] font-semibold">{c.selection}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[var(--quote-val)]">@{Number(c.odds).toFixed(2)}</span>
                    <button onClick={() => removePick(c.id)} className="text-rose-500 text-xs px-1 cursor-pointer">✕</button>
                  </div>
                </div>
              ))}

              <div className="pt-3 mt-2 border-t border-[var(--border-subtle)] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Puntata Totale:</span>
                  <span className="font-mono font-bold">{stake} €</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Quota Totale:</span>
                  <span className="font-mono font-bold">@{totalOdds}</span>
                </div>
                <div className="flex justify-between text-emerald-500 text-base font-mono font-black pt-1">
                  <span>Vincita Totale:</span>
                  <span>{potentialWin} €</span>
                </div>

                {/* Box a Testa nella Tendina */}
                <div className="bg-[var(--surface-sub)] p-2.5 rounded border border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <div>
                    <span className="block text-[10px] text-[var(--text-muted)] uppercase">Spesa a testa ({safeParticipants} pers.):</span>
                    <span className="font-mono font-bold text-amber-500">{stakePerHead} €</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] text-[var(--text-muted)] uppercase">Vincita a testa:</span>
                    <span className="font-mono font-bold text-emerald-500">{winPerHead} €</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={exportStoryCard}
                    className="flex-1 bg-[var(--surface-quote)] border border-[var(--border-subtle)] hover:border-[#0084ff] py-2 rounded text-xs font-bold text-center cursor-pointer"
                  >
                    📸 Scarica Storia
                  </button>
                  <button
                    onClick={copyForWhatsApp}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-xs font-bold text-center cursor-pointer"
                  >
                    Condividi Link
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Footer Bar con Trigger Tendina */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[var(--surface-header)]/95 backdrop-blur border-t border-[var(--border-subtle)] px-3 py-2 z-40 flex items-center justify-between pb-safe shadow-lg">
        <div onClick={() => setIsSheetOpen(true)} className="cursor-pointer">
          <div className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
            <span>{confirmed.length} EVENTI • @{totalOdds}</span>
            <span className="text-[8px] bg-[#0084ff]/20 text-[#0084ff] px-1 rounded">▲ APRI</span>
          </div>
          <div className="text-sm font-mono font-black text-emerald-500">
            {potentialWin} € <span className="text-[10px] font-normal text-[var(--text-muted)]">({winPerHead}€/cad)</span>
          </div>
        </div>

        <button
          onClick={() => setIsSheetOpen(!isSheetOpen)}
          className="bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white font-bold text-xs uppercase px-3 py-2 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer"
        >
          <span>Vedi Schedina</span>
          <span className="text-[10px]">{isSheetOpen ? "▼" : "▲"}</span>
        </button>
      </footer>
    </div>
  );
}