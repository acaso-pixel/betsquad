"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RoomPage() {
  const params = useParams();
  const rawId = params?.id;
  const roomId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "BS-SESSION";

  const [roomData, setRoomData] = useState<any>(null);
  const [roomName, setRoomName] = useState<string>("");
  const [tempRoomName, setTempRoomName] = useState<string>("");
  const [betMode, setBetMode] = useState<"libera" | "voto">("libera");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [matches, setMatches] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"palinsesto" | "voti" | "schedina">("palinsesto");
  const [selectedLeague, setSelectedLeague] = useState<string>("Serie A TIM");
  const [marketFilter, setMarketFilter] = useState<"1X2" | "DC" | "UO" | "GG" | "MG">("1X2");
  const [stake, setStake] = useState<number>(10);
  const [participantsCount, setParticipantsCount] = useState<number>(4);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [nick, setNick] = useState<string>("Giocatore");
  const [tempNick, setTempNick] = useState<string>("Giocatore");
  const [toast, setToast] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<any>(null);

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
    let savedNick = localStorage.getItem("bs_nick");
    if (!savedNick) {
      savedNick = `Player_${Math.floor(1000 + Math.random() * 9000)}`;
      localStorage.setItem("bs_nick", savedNick);
    }
    setNick(savedNick);
    setTempNick(savedNick);

    supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRoomData(data);
          const nameVal = data.name || `Schedina #${roomId}`;
          setRoomName(nameVal);
          setTempRoomName(nameVal);
          if (data.bet_mode) {
            const mapped = data.bet_mode === "congiunta" ? "voto" : data.bet_mode === "disgiunta" ? "libera" : data.bet_mode;
            setBetMode(mapped);
          }
        } else {
          const fallback = `Schedina #${roomId}`;
          setRoomName(fallback);
          setTempRoomName(fallback);
        }
      });

    fetch(`/api/odds?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => {
        const rawList = Array.isArray(d.matches) ? d.matches : [];
        const normalized = rawList.map((m: any) => ({
          ...m,
          league: m.league || "Serie A TIM"
        }));
        setMatches(normalized);
      })
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
    channelRef.current = channel;

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
        if (payload.new) {
          if (payload.new.name) {
            setRoomName(payload.new.name);
            setTempRoomName(payload.new.name);
          }
          if (payload.new.bet_mode) {
            const mapped = payload.new.bet_mode === "congiunta" ? "voto" : payload.new.bet_mode === "disgiunta" ? "libera" : payload.new.bet_mode;
            setBetMode(mapped);
            showToast(`⚙️ Regole: ${mapped === "libera" ? "MODIFICA LIBERA" : "MODALITÀ A VOTO"}`);
          }
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

  const commitNick = async () => {
    const val = tempNick.trim() || `Player_${Math.floor(1000 + Math.random() * 9000)}`;
    setNick(val);
    setTempNick(val);
    localStorage.setItem("bs_nick", val);
    showToast(`👤 Nickname: ${val}`);

    if (channelRef.current) {
      try {
        await channelRef.current.track({ online_at: new Date().toISOString(), nick: val });
      } catch {}
    }
  };

  const commitRoomName = async () => {
    const val = tempRoomName.trim() || `Schedina #${roomId}`;
    setRoomName(val);
    setTempRoomName(val);
    showToast(`📝 Nome sessione salvato`);
    try {
      await supabase.from("rooms").update({ name: val }).eq("id", roomId);
    } catch {}
  };

  const toggleBetMode = async (newMode: "libera" | "voto") => {
    if (!isHost) {
      showToast("⛔ Solo l'Host può cambiare la modalità!");
      return;
    }
    setBetMode(newMode);
    showToast(`Modalità: ${newMode === "libera" ? "Libera" : "A Voto"}`);

    try {
      await supabase.from("rooms").update({ bet_mode: newMode }).eq("id", roomId);
    } catch {}
  };

  const filteredMatches = useMemo(() => {
    const matchesForLeague = matches.filter((m) => (m.league || "Serie A TIM") === selectedLeague);
    return matchesForLeague.length > 0 ? matchesForLeague : (selectedLeague === "Serie A TIM" ? matches : []);
  }, [matches, selectedLeague]);

  const groupedMatches = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    const sorted = [...filteredMatches].sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

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
  }, [filteredMatches]);

  const isSelected = (matchId: string, market: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.market === market && p.selection === sel && p.status !== "rejected");
  };

  // LOGICA BOOKMAKER: Sostituzione Automatica della quota dello stesso match
  const handlePickAction = async (match: any, market: string, selection: string, odds: number) => {
    const existingSame = picks.find((p) => p.match_id === match.id && p.market === market && p.selection === selection);
    
    // 1. Deselezione al secondo tocco
    if (existingSame) {
      if (betMode === "libera") {
        removePick(existingSame.id);
        return;
      } else {
        showToast("⚠️ Quota già proposta in votazione.");
        return;
      }
    }

    const isDirect = betMode === "libera";
    const initialStatus = isDirect ? "confirmed" : "pending";

    // 2. SOSTITUZIONE AUTOMATICA: Se c'è già un pronostico su questa partita, lo sostituisce direttamente
    const existingMatchPick = picks.find((p) => p.match_id === match.id && p.status !== "rejected");

    if (existingMatchPick) {
      // Aggiornamento in-place
      const updatedPick = {
        ...existingMatchPick,
        market,
        selection,
        odds,
        proposed_by: nick,
        status: initialStatus
      };

      setPicks((prev) => prev.map((p) => (p.id === existingMatchPick.id ? updatedPick : p)));
      showToast(`🔄 Sostituito: ${selection} (${market})`);

      try {
        await supabase
          .from("room_picks")
          .update({
            market,
            selection,
            odds,
            proposed_by: nick,
            status: initialStatus
          })
          .eq("id", existingMatchPick.id);
      } catch {}
      return;
    }

    // 3. Controllo limite massimo 30 eventi
    const activePicks = picks.filter((p) => p.status !== "rejected");
    if (activePicks.length >= 30) {
      showToast("⛔ Limite massimo di 30 eventi per schedina raggiunto!");
      return;
    }

    // 4. Inserimento nuovo evento
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
    showToast(isDirect ? `✅ Inserito: ${selection}` : `🗳️ Proposta: ${selection}`);

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

  // ALGORITMO UFFICIALE DI CALCOLO LOTTOMATICA / ADM:
  const rawMultiplier = confirmed.reduce((acc, p) => acc * Number(p.odds), 1);
  const totalOdds = confirmed.length > 0 ? (Math.round(rawMultiplier * 100) / 100).toFixed(2) : "0.00";

  // Bonus Multipla: Quote >= 1.25, attivo dal 5° evento (+5%, poi +5% ogni evento successivo)
  const qualifyingEvents = confirmed.filter((p) => Number(p.odds) >= 1.25).length;
  const bonusPct = qualifyingEvents >= 5 ? (qualifyingEvents - 4) * 5 : 0;
  const bonusMultiplier = 1 + bonusPct / 100;

  const rawPotentialWin = confirmed.length > 0 ? Number(stake) * Number(totalOdds) * bonusMultiplier : 0;
  // Cap Vincita di Legge ADM / Lottomatica: Max 50.000,00 €
  const isCapped = rawPotentialWin > 50000;
  const potentialWin = confirmed.length > 0 ? (Math.min(50000, Math.round(rawPotentialWin * 100) / 100)).toFixed(2) : "0.00";
  const baseWin = confirmed.length > 0 ? (Math.round(Number(stake) * Number(totalOdds) * 100) / 100) : 0;

  const safeParticipants = Math.max(1, participantsCount);
  const stakePerHead = (stake / safeParticipants).toFixed(2);
  const winPerHead = (Number(potentialWin) / safeParticipants).toFixed(2);

  const copyForWhatsApp = () => {
    const text = `🔥 BetSquad [${roomId}]\n` +
      `📌 Sessione: ${roomName}\n` +
      `⚙️ Regole: ${betMode === "libera" ? "Libera" : "A Voto"}\n` +
      `👥 Partecipanti: ${safeParticipants} (${stakePerHead}€ a testa)\n` +
      `📌 Pronostici (${confirmed.length}):\n` +
      confirmed.map((c) => `• ${c.match_label}: ${c.selection} [${c.market}] @${Number(c.odds).toFixed(2)}`).join("\n") +
      `\n\n💰 Quota Totale: @${totalOdds}` +
      (bonusPct > 0 ? `\n🎁 Bonus Multipla: +${bonusPct}%` : "") +
      `\n💵 Puntata: ${stake}€ (Vincita a testa: ${winPerHead}€)` +
      `\n🏆 Vincita Totale: ${potentialWin}€` + (isCapped ? " (Massimale ADM 50.000€)" : "") +
      `\n🔗 Entra nella stanza: ${window.location.href}`;

    navigator.clipboard.writeText(text);
    showToast("📋 Schedina copiata per WhatsApp!");
  };

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

    const grad = ctx.createLinearGradient(0, 0, 0, 1920);
    grad.addColorStop(0, "#070c14");
    grad.addColorStop(0.5, "#0e1824");
    grad.addColorStop(1, "#05080d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    ctx.save();
    ctx.font = "900 64px sans-serif";
    const betTextW = ctx.measureText("BET").width;
    const squadTextW = ctx.measureText("SQUAD").width;

    const betPadX = 24;
    const badgeW = betTextW + betPadX * 2;
    const badgeH = 88;
    const gap = 20;
    const totalLogoW = badgeW + gap + squadTextW;

    const startX = (1080 - totalLogoW) / 2;
    const logoY = 120;

    ctx.fillStyle = "#0084ff";
    drawRoundedRect(ctx, startX, logoY, badgeW, badgeH, 18);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BET", startX + badgeW / 2, logoY + badgeH / 2 + 2);

    ctx.textAlign = "left";
    ctx.fillText("SQUAD", startX + badgeW + gap, logoY + badgeH / 2 + 2);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SCHEDINA DEL GIORNO", 1080 / 2, 280);
    ctx.restore();

    ctx.fillStyle = "rgba(22, 36, 54, 0.85)";
    drawRoundedRect(ctx, 80, 330, 920, 1020, 28);

    let yPos = 420;
    if (confirmed.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "italic 40px sans-serif";
      ctx.fillText("Nessun pronostico inserito", 140, yPos);
    } else {
      confirmed.slice(0, 8).forEach((c, idx) => {
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 34px sans-serif";
        const label = c.match_label.length > 25 ? c.match_label.substring(0, 23) + "..." : c.match_label;
        ctx.fillText(`${idx + 1}. ${label}`, 120, yPos);

        ctx.fillStyle = "#0084ff";
        ctx.font = "bold 32px sans-serif";
        ctx.fillText(`Pronostico: ${c.selection} (${c.market})`, 120, yPos + 44);

        ctx.textAlign = "right";
        ctx.fillStyle = "#f59e0b";
        ctx.font = "900 38px monospace";
        ctx.fillText(`@${Number(c.odds).toFixed(2)}`, 950, yPos + 25);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(120, yPos + 80);
        ctx.lineTo(960, yPos + 80);
        ctx.stroke();

        yPos += 120;
      });
    }

    ctx.fillStyle = "#162436";
    drawRoundedRect(ctx, 80, 1400, 920, 420, 28);

    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("QUOTA TOTALE", 140, 1480);
    ctx.fillText("PUNTATA", 660, 1480);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 58px monospace";
    ctx.fillText(`@${totalOdds}`, 140, 1560);
    ctx.fillText(`${stake} €`, 660, 1560);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("POTENZIALE VINCITA:", 140, 1670);

    ctx.font = "900 96px monospace";
    ctx.fillText(`${potentialWin} €`, 140, 1780);

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `BetSquad-Schedina.png`;
    link.href = dataUrl;
    link.click();
    showToast("📸 Card Storia scaricata!");
  };

  const bookmakers = [
    { name: "Sisal.it", bonus: 1.05, link: "https://www.sisal.it" },
    { name: "Snai.it", bonus: 1.04, link: "https://www.snai.it" },
    { name: "GoldBet", bonus: 1.03, link: "https://www.goldbet.it" },
  ];

  const competitions = [
    { name: "Serie A TIM", code: "IT", region: "Italia" },
    { name: "Premier League", code: "EN", region: "Inghilterra" },
    { name: "LaLiga", code: "ES", region: "Spagna" },
    { name: "Bundesliga", code: "DE", region: "Germania" },
    { name: "Champions League", code: "EU", region: "Europa" }
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] pb-24 font-sans antialiased select-none">
      <canvas ref={canvasRef} className="hidden" />

      {/* Toast Notifica riposizionato per non coprire gli input */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-[11px] font-bold px-4 py-2 rounded-full shadow-2xl border border-white/20">
          {toast}
        </div>
      )}

      {/* MODAL REGOLE & TERMINI ADM */}
      {showRulesModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowRulesModal(false)}
        >
          <div 
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span className="font-black text-sm uppercase tracking-wider text-white">⚖️ Regolamento Scommesse ADM</span>
              <button 
                onClick={() => setShowRulesModal(false)} 
                className="text-sm font-bold text-[var(--text-muted)] hover:text-white px-2 py-0.5 rounded bg-[var(--surface-quote)] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-[var(--text-muted)]">
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">1. Importi di Puntata e Vincita Massima</h4>
                <p>La puntata minima ammessa è di <strong>1,00 €</strong>. Il massimale di vincita per singolo biglietto (singola o multipla) è fissato a <strong>€ 50.000,00</strong> a norma di legge ADM.</p>
              </div>
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">2. Incompatibilità e Sostituzione Esiti</h4>
                <p>Non è consentito combinare esiti correlati dello stesso evento. Selezionando un nuovo mercato per lo stesso incontro, il sistema effettua la <strong>sostituzione automatica</strong> della quota.</p>
              </div>
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">3. Bonus Multipla Progressivo</h4>
                <p>Partecipano al bonus solo gli eventi con <strong>quota pari o superiore a 1.25</strong>. Il bonus si attiva dal 5° evento valido (+5%) e incrementa del +5% per ogni evento successivo fino a 30 selezioni.</p>
              </div>
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">4. Avvenimenti Annullati o Rinviati (Quota 1.00)</h4>
                <p>Qualora un incontro venga posticipato e non disputato entro i termini ufficiali, la selezione viene considerata nulla e calcolata a <strong>quota 1.00</strong> senza invalidare il resto della multipla.</p>
              </div>
            </div>

            <button
              onClick={() => setShowRulesModal(false)}
              className="w-full py-2 bg-[#0084ff] text-white text-xs font-bold uppercase rounded-lg cursor-pointer"
            >
              Ho Capito
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] sticky top-0 z-30 px-3 py-2 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="bg-[#0084ff] text-white font-black text-[11px] px-2 py-0.5 rounded">BET</span>
          <span className="font-extrabold text-sm tracking-tight hidden sm:inline">SQUAD</span>
        </div>

        <div className="flex-1 max-w-sm mx-1 flex items-center justify-center gap-1.5">
          <input
            type="text"
            value={tempRoomName}
            onChange={(e) => setTempRoomName(e.target.value)}
            onBlur={commitRoomName}
            onKeyDown={(e) => e.key === "Enter" && commitRoomName()}
            title="Clicca per modificare il nome della stanza"
            className="w-1/2 h-8 px-2 bg-[var(--surface-card)] hover:bg-[var(--surface-sub)] border border-[var(--border-subtle)] focus:border-[#0084ff] rounded text-xs font-bold text-center text-[var(--text-main)] truncate focus:outline-none transition cursor-text"
          />
          <input
            type="text"
            value={tempNick}
            onChange={(e) => setTempNick(e.target.value)}
            onBlur={commitNick}
            onKeyDown={(e) => e.key === "Enter" && commitNick()}
            title="Clicca per cambiare il tuo nickname"
            className="w-1/2 h-8 px-2 bg-[var(--surface-card)] hover:bg-[var(--surface-sub)] border border-[var(--border-subtle)] focus:border-[#0084ff] rounded text-xs font-semibold text-center text-[#0084ff] truncate focus:outline-none transition cursor-text"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowRulesModal(true)}
            className="h-9 px-2.5 rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-xs font-bold hover:border-[#0084ff] transition cursor-pointer shadow-sm flex items-center gap-1"
            title="Consulta le regole ufficiali ADM"
          >
            <span>⚖️</span>
            <span className="hidden sm:inline text-[11px]">Regole</span>
          </button>
          <button
            onClick={exportStoryCard}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-base hover:border-[#0084ff] transition cursor-pointer shadow-sm active:scale-95"
            title="Scarica Card Instagram"
          >
            📸
          </button>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-base hover:border-[#0084ff] transition cursor-pointer shadow-sm active:scale-95"
            title="Cambia tema chiaro/scuro"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            onClick={copyForWhatsApp}
            className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center justify-center cursor-pointer shadow-sm transition active:scale-95"
          >
            <span>Invia</span>
          </button>
        </div>
      </header>

      {/* Barra Presenze & Switch Modalità */}
      <div className="bg-[var(--surface-card)] border-b border-[var(--border-subtle)] px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 truncate pr-2">
          <span className="text-[var(--text-muted)] font-mono text-xs">{roomId}</span>
          {isHost && <span className="bg-amber-500/20 text-amber-500 text-[10px] font-bold px-1.5 py-0.5 rounded">HOST</span>}
          {onlineUsers.length > 0 && (
            <span className="text-emerald-500 font-mono text-xs flex items-center gap-1 border-l border-[var(--border-subtle)] pl-2">
              🟢 {onlineUsers.length} online
            </span>
          )}
        </div>

        {isHost ? (
          <div className="flex items-center gap-1 bg-[var(--bg-main)] p-1 rounded-md border border-[var(--border-subtle)] shrink-0">
            <button
              onClick={() => toggleBetMode("libera")}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                betMode === "libera" ? "bg-[#0084ff] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              ⚡ Libera
            </button>
            <button
              onClick={() => toggleBetMode("voto")}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                betMode === "voto" ? "bg-[#0084ff] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              🗳️ A Voto
            </button>
          </div>
        ) : (
          <span className={`text-xs font-bold px-2 py-1 rounded ${
            betMode === "libera" ? "text-emerald-500 bg-emerald-500/10" : "text-amber-500 bg-amber-500/10"
          }`}>
            {betMode === "libera" ? "⚡ Libera" : "🗳️ A Voto"}
          </span>
        )}
      </div>

      {/* Tabs Principali */}
      <div className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] px-3 flex text-xs font-bold uppercase tracking-wider overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab("palinsesto")}
          className={`py-2 px-4 transition whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "palinsesto" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Palinsesto Quote
        </button>
        <button
          onClick={() => setActiveTab("voti")}
          className={`py-2 px-4 flex items-center gap-1.5 whitespace-nowrap border-b-2 cursor-pointer ${
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
          className={`py-2 px-4 flex items-center gap-1.5 whitespace-nowrap border-b-2 cursor-pointer ${
            activeTab === "schedina" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          Schedina Squad
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-500 font-mono">
            {confirmed.length}
          </span>
        </button>
      </div>

      {/* Selettore Competizioni Mobile */}
      {activeTab === "palinsesto" && (
        <div className="md:hidden bg-[var(--surface-card)] border-b border-[var(--border-subtle)] px-2.5 py-2 overflow-x-auto flex gap-1.5 no-scrollbar">
          {competitions.map((comp) => (
            <button
              key={comp.name}
              onClick={() => setSelectedLeague(comp.name)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 border transition cursor-pointer ${
                selectedLeague === comp.name
                  ? "bg-[#0084ff] border-[#0084ff] text-white shadow-sm"
                  : "bg-[var(--surface-quote)] border-[var(--border-subtle)] text-[var(--text-muted)]"
              }`}
            >
              <span className="font-mono text-[10px] uppercase font-bold bg-white/10 px-1 rounded">{comp.code}</span>
              <span>{comp.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Layout SNAI Style */}
      <main className="p-2 sm:p-4 w-full">
        {activeTab === "palinsesto" && (
          <div className="flex flex-col md:flex-row gap-3 items-start w-full">
            {/* Sidebar Desktop Altre Competizioni */}
            <aside className="hidden md:block w-64 shrink-0 bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] pb-2 mb-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <span>Altre Competizioni</span>
                <span className="text-[10px] text-[#0084ff] font-bold">CALCIO</span>
              </div>
              <div className="space-y-1">
                {competitions.map((comp) => (
                  <button
                    key={comp.name}
                    onClick={() => setSelectedLeague(comp.name)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-bold transition cursor-pointer ${
                      selectedLeague === comp.name
                        ? "bg-[#0084ff] text-white shadow-sm"
                        : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] text-[var(--text-main)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/25">{comp.code}</span>
                      <span>{comp.name}</span>
                    </span>
                    <span className="text-[10px] opacity-75 font-mono">➔</span>
                  </button>
                ))}
              </div>
            </aside>

            {/* Tabella Palinsesto */}
            <div className="flex-1 min-w-0 w-full space-y-3">
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#0084ff] text-white">
                    {competitions.find(c => c.name === selectedLeague)?.code}
                  </span>
                  <span className="text-xs font-bold uppercase text-white tracking-wide">{selectedLeague}</span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 bg-[var(--bg-main)] p-1 rounded-lg border border-[var(--border-subtle)] w-full sm:w-auto overflow-x-auto">
                  {[
                    { id: "1X2", label: "Esito Finale 1x2" },
                    { id: "DC", label: "Doppia Chance" },
                    { id: "UO", label: "Under/Over" },
                    { id: "GG", label: "Goal/NoGoal" },
                    { id: "MG", label: "Multigoal" }
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMarketFilter(m.id as any)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        marketFilter === m.id
                          ? "bg-[#0084ff] text-white shadow-sm"
                          : "text-[var(--text-muted)] hover:text-white"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="text-center py-12 text-xs text-[var(--text-muted)] bg-[var(--surface-card)] rounded-lg border border-[var(--border-subtle)]">
                  Caricamento quote in corso...
                </div>
              ) : Object.keys(groupedMatches).length === 0 ? (
                <div className="text-center py-12 text-xs text-[var(--text-muted)] bg-[var(--surface-card)] rounded-lg border border-[var(--border-subtle)]">
                  Nessun match in programma per {selectedLeague}.
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedMatches).map(([dateLabel, matchList]) => (
                    <div key={dateLabel} className="bg-[var(--surface-header)] border border-[var(--border-subtle)] rounded-lg overflow-hidden shadow-sm">
                      <div className="bg-[var(--surface-sub)] px-3 py-1.5 text-xs font-bold flex items-center justify-between border-b border-[var(--border-subtle)]">
                        <span>📅 {dateLabel}</span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase">
                          {marketFilter === "1X2" ? "1 • X • 2" : marketFilter === "DC" ? "1X • 12 • X2" : marketFilter === "UO" ? "Over 2.5 • Under 2.5" : marketFilter === "GG" ? "Goal • NoGoal" : "1-3 • 2-4 • 2-5"}
                        </span>
                      </div>

                      <div className="divide-y divide-[var(--border-subtle)]">
                        {matchList.map((m) => {
                          const timeStr = new Date(m.commence_time).toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          });

                          return (
                            <div key={m.id} className="p-3 flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1 pr-2">
                                <span className="text-[10px] font-mono text-[var(--text-muted)] block mb-0.5">{timeStr}</span>
                                <div className="text-xs font-bold truncate">{m.home}</div>
                                <div className="text-xs font-bold truncate">{m.away}</div>
                              </div>

                              <div className="shrink-0">
                                {marketFilter === "1X2" && (
                                  <div className="grid grid-cols-3 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["1", "X", "2"] as const).map((lbl) => {
                                      const val = Number(m.odds1X2?.[lbl] || 2.0);
                                      const selected = isSelected(m.id, "1X2", lbl);
                                      return (
                                        <button
                                          key={lbl}
                                          onClick={() => handlePickAction(m, "1X2", lbl, val)}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer ${
                                            selected
                                              ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                              : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                          }`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {marketFilter === "DC" && (
                                  <div className="grid grid-cols-3 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["1X", "12", "X2"] as const).map((lbl) => {
                                      const val = Number(m.oddsDC?.[lbl] || 1.35);
                                      const selected = isSelected(m.id, "Doppia Chance", lbl);
                                      return (
                                        <button
                                          key={lbl}
                                          onClick={() => handlePickAction(m, "Doppia Chance", lbl, val)}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer ${
                                            selected
                                              ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                              : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                          }`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {marketFilter === "UO" && (
                                  <div className="grid grid-cols-2 gap-1.5 w-[170px] sm:w-[200px]">
                                    {(["Over 2.5", "Under 2.5"] as const).map((lbl) => {
                                      const val = Number(m.oddsUO?.[lbl] || 1.85);
                                      const selected = isSelected(m.id, "Under/Over", lbl);
                                      return (
                                        <button
                                          key={lbl}
                                          onClick={() => handlePickAction(m, "Under/Over", lbl, val)}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer ${
                                            selected
                                              ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                              : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                          }`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {marketFilter === "GG" && (
                                  <div className="grid grid-cols-2 gap-1.5 w-[170px] sm:w-[200px]">
                                    {(["Goal", "NoGoal"] as const).map((lbl) => {
                                      const val = Number(m.oddsGG?.[lbl] || 1.8);
                                      const selected = isSelected(m.id, "Goal/NoGoal", lbl);
                                      return (
                                        <button
                                          key={lbl}
                                          onClick={() => handlePickAction(m, "Goal/NoGoal", lbl, val)}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer ${
                                            selected
                                              ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                              : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                          }`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {marketFilter === "MG" && (
                                  <div className="grid grid-cols-3 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["1-3 Goal", "2-4 Goal", "2-5 Goal"] as const).map((lbl) => {
                                      const val = Number(m.oddsMG?.[lbl] || 1.45);
                                      const selected = isSelected(m.id, "Multigoal", lbl);
                                      return (
                                        <button
                                          key={lbl}
                                          onClick={() => handlePickAction(m, "Multigoal", lbl, val)}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer ${
                                            selected
                                              ? "bg-[#0084ff] border-white text-white shadow-sm font-black"
                                              : "bg-[var(--surface-quote)] active:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                                          }`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
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
          </div>
        )}

        {/* Tab 2: Votazioni */}
        {activeTab === "voti" && (
          <div className="max-w-4xl mx-auto space-y-2">
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

        {/* Tab 3: Schedina Squad con Regolamento Completo */}
        {activeTab === "schedina" && (
          <div className="max-w-4xl mx-auto bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider">Schedina Squad ({confirmed.length}/30)</span>
                <button
                  onClick={() => setShowRulesModal(true)}
                  className="text-[10px] text-[#0084ff] underline cursor-pointer"
                >
                  Regolamento ADM
                </button>
              </div>
              <div className="flex items-center gap-1 bg-[var(--bg-main)] p-1 rounded border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)]">Puntata:</span>
                {[1, 2, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    onClick={() => setStake(val)}
                    className={`px-2 py-0.5 rounded text-xs font-bold cursor-pointer ${
                      stake === val ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {val}€
                  </button>
                ))}
              </div>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-center py-10 text-xs text-[var(--text-muted)]">
                Nessuna giocata in schedina. Seleziona le quote nel palinsesto.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="divide-y divide-[var(--border-subtle)]">
                  {confirmed.map((c) => (
                    <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div className="pr-2 truncate">
                        <div className="font-bold truncate">{c.match_label}</div>
                        <div className="text-[11px] text-[#0084ff] font-semibold">{c.selection} ({c.market})</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-[var(--quote-val)] text-sm">@{Number(c.odds).toFixed(2)}</span>
                        <button onClick={() => removePick(c.id)} className="text-rose-500 px-1 text-sm cursor-pointer">✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Quota moltiplicatore:</span>
                    <span className="font-mono font-bold text-sm">@{totalOdds}</span>
                  </div>
                  {bonusPct > 0 && (
                    <div className="flex justify-between text-amber-500">
                      <span>Bonus Multipla ({qualifyingEvents} eventi ≥ 1.25: +{bonusPct}%):</span>
                      <span className="font-mono font-bold">+{((Number(potentialWin) - baseWin)).toFixed(2)} €</span>
                    </div>
                  )}

                  <div className="flex justify-between items-baseline pt-2 border-t border-[var(--border-subtle)]">
                    <div>
                      <span className="font-bold uppercase text-xs block">Potenziale Vincita ({stake}€):</span>
                      {isCapped && (
                        <span className="text-[10px] text-amber-500 font-bold">Massimale di legge ADM € 50.000,00 raggiunto</span>
                      )}
                    </div>
                    <span className="text-2xl font-mono font-black text-emerald-500">{potentialWin} €</span>
                  </div>

                  {/* Comparatore Bookmaker Integrato */}
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                    <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase block mb-2">
                      Confronto Payout Bookmaker ADM ({stake}€):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {bookmakers.map((b) => (
                        <div key={b.name} className="bg-[var(--surface-sub)] p-2.5 rounded-lg border border-[var(--border-subtle)] flex sm:flex-col justify-between items-center sm:items-start gap-1">
                          <div>
                            <span className="font-bold text-xs block">{b.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)]">Bonus applicato</span>
                          </div>
                          <div className="flex items-center sm:w-full sm:justify-between gap-2">
                            <span className="text-sm font-mono font-bold text-emerald-500">
                              {(Math.min(50000, Number(potentialWin) * b.bonus)).toFixed(2)} €
                            </span>
                            <a
                              href={b.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] bg-[#0084ff] text-white px-2 py-0.5 rounded font-bold uppercase"
                            >
                              Apri ↗
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Divisione Spesa a Testa */}
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
      </main>

      {/* Widget Schedina Flottante NovaJackpot */}
      {activeTab !== "schedina" && (
        <div className="fixed bottom-3 right-3 sm:right-6 z-40 flex flex-col items-end pointer-events-none">
          <div
            className={`w-[calc(100vw-24px)] max-w-[340px] sm:max-w-[380px] bg-[var(--surface-card)] border border-[var(--border-strong)] rounded-xl shadow-2xl p-3.5 mb-2 transition-all duration-300 pointer-events-auto max-h-[65vh] overflow-y-auto ${
              isSheetOpen
                ? "opacity-100 translate-y-0 scale-100"
                : "opacity-0 translate-y-4 scale-95 pointer-events-none"
            }`}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
              <span className="text-xs font-bold uppercase tracking-wider">Schedina Rapida ({confirmed.length}/30)</span>
              <button
                onClick={() => setIsSheetOpen(false)}
                className="text-xs font-bold text-[var(--text-muted)] hover:text-white px-2 py-0.5 rounded bg-[var(--surface-quote)] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {confirmed.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                Schedina vuota. Clicca sulle quote in pagina per aggiungerle.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] py-1.5">
                {confirmed.map((c) => (
                  <div key={c.id} className="py-1.5 flex items-center justify-between text-xs">
                    <div className="pr-2 truncate">
                      <div className="font-bold truncate">{c.match_label}</div>
                      <div className="text-[10px] text-[#0084ff] font-semibold">{c.selection}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono font-bold text-[var(--quote-val)] text-xs">@{Number(c.odds).toFixed(2)}</span>
                      <button onClick={() => removePick(c.id)} className="text-rose-500 text-xs px-1 cursor-pointer">✕</button>
                    </div>
                  </div>
                ))}

                <div className="pt-2 mt-1 space-y-1.5 text-xs">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Quota: @{totalOdds}</span>
                    <span className="text-[var(--text-muted)]">Puntata: {stake}€</span>
                  </div>
                  <div className="flex justify-between items-baseline pt-1 text-emerald-500 font-mono font-black text-base">
                    <span className="text-xs uppercase font-bold text-[var(--text-muted)]">Vincita:</span>
                    <span>{potentialWin} €</span>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setIsSheetOpen(false);
                        setActiveTab("schedina");
                      }}
                      className="w-full h-10 bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 cursor-pointer shadow-md transition"
                    >
                      <span>Vai a Schedina Squad</span>
                      <span>➔</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsSheetOpen(!isSheetOpen)}
            className="pointer-events-auto h-12 px-5 rounded-full bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white font-black text-xs uppercase tracking-wider shadow-2xl flex items-center gap-2.5 cursor-pointer border border-white/20 transition-transform active:scale-95"
          >
            <span>SCHEDINA</span>
            <span className="px-2 py-0.5 rounded-full bg-white/25 text-xs font-mono">
              {confirmed.length}
            </span>
            <span className="text-xs">{isSheetOpen ? "▼" : "▲"}</span>
          </button>
        </div>
      )}
    </div>
  );
}