"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { 
  Scale, Camera, Sun, Moon, Share2, Search, Pin, PinOff, 
  ThumbsUp, ThumbsDown, CheckCircle2, XCircle, Trophy, 
  ExternalLink, Users, QrCode, ArrowRight, Trash2, ShieldAlert,
  Flame, Sparkles, RefreshCw, AlertCircle
} from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<"palinsesto" | "voti" | "schedina" | "storico">("palinsesto");
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
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [searchLeagueQuery, setSearchLeagueQuery] = useState("");
  const [pinnedLeagues, setPinnedLeagues] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        return JSON.parse(localStorage.getItem("bs_pinned_leagues") || '["Serie A TIM", "Premier League"]');
      } catch { return ["Serie A TIM", "Premier League"]; }
    }
    return ["Serie A TIM", "Premier League"];
  });

  const [detailMatch, setDetailMatch] = useState<any | null>(null);
  const [detailCategory, setDetailCategory] = useState<string>("PRINCIPALI");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<any>(null);
  const picksRef = useRef<any[]>([]);

  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

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

  const togglePinLeague = (leagueName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let updated;
    if (pinnedLeagues.includes(leagueName)) {
      updated = pinnedLeagues.filter(l => l !== leagueName);
    } else {
      updated = [...pinnedLeagues, leagueName];
    }
    setPinnedLeagues(updated);
    localStorage.setItem("bs_pinned_leagues", JSON.stringify(updated));
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

    const abortController = new AbortController();

    supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .maybeSingle()
      .then(async ({ data }) => {
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
          try {
            await supabase.from("rooms").upsert({
              id: roomId,
              name: fallback,
              host_id: savedNick,
              bet_mode: "libera",
            });
          } catch {}
        }
      });

    fetch(`/api/odds?t=${Date.now()}`, { cache: "no-store", signal: abortController.signal })
      .then((res) => res.json())
      .then((d) => {
        const rawList = Array.isArray(d.matches) ? d.matches : [];
        const normalized = rawList.map((m: any, index: number) => {
          const cleanHome = (m.home || `TeamA_${index}`).trim();
          const cleanAway = (m.away || `TeamB_${index}`).trim();
          const stableId = m.id && String(m.id).trim().length > 0
            ? String(m.id).trim()
            : `match_${cleanHome}_${cleanAway}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

          return {
            ...m,
            id: stableId,
            home: cleanHome,
            away: cleanAway,
            league: m.league || "Serie A TIM"
          };
        });
        setMatches(normalized);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setMatches([]);
      })
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
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_picks", filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          setPicks((prev) => {
            const exists = prev.some((p) => p.id === payload.new.id || (p.match_id === payload.new.match_id && p.selection === payload.new.selection));
            return exists ? prev.map(p => (p.match_id === payload.new.match_id && p.selection === payload.new.selection ? payload.new : p)) : [...prev, payload.new];
          });
          showToast(`🔔 Nuova proposta da ${payload.new.proposed_by || "un utente"}!`);
        } else if (payload.eventType === "UPDATE") {
          setPicks((prev) => prev.map((p) => (p.id === payload.new.id ? payload.new : p)));
        } else if (payload.eventType === "DELETE") {
          setPicks((prev) => prev.filter((p) => p.id !== payload.old.id));
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
          }
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      abortController.abort();
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

  const isSelected = useCallback((matchId: string, sel: string) => {
    return picks.some((p) => p.match_id === matchId && p.selection === sel && p.status !== "rejected");
  }, [picks]);

  const handlePickAction = async (match: any, market: string, selection: string, odds: number) => {
    const isDirect = betMode === "libera";
    const initialStatus = isDirect ? "confirmed" : "pending";
    const safeMatchId = match.id;
    const currentPicks = picksRef.current;

    const existingSameSelection = currentPicks.find(
      (p) => p.match_id === safeMatchId && p.selection === selection && p.status !== "rejected"
    );

    if (existingSameSelection) {
      if (betMode === "libera") {
        removePick(existingSameSelection.id);
      } else {
        showToast("⚠️ Pronostico già presente.");
      }
      return;
    }

    const existingMatchPick = currentPicks.find(
      (p) => p.match_id === safeMatchId && p.status !== "rejected"
    );

    if (existingMatchPick) {
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

    const tempId = `pick_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newPick = {
      id: tempId,
      room_id: roomId,
      match_id: safeMatchId,
      match_label: `${match.home} - ${match.away}`,
      market,
      selection,
      odds,
      proposed_by: nick,
      votes: { [nick]: 1 },
      status: initialStatus,
    };

    setPicks((prev) => [...prev, newPick]);
    showToast(isDirect ? `✅ Aggiunto: ${selection}` : `🗳️ Proposta inviata in votazione!`);

    try {
      const { data, error } = await supabase.from("room_picks").insert({
        room_id: roomId,
        match_id: safeMatchId,
        match_label: newPick.match_label,
        market,
        selection,
        odds,
        proposed_by: nick,
        votes: newPick.votes,
        status: initialStatus,
      }).select().single();

      if (!error && data) {
        setPicks((prev) => prev.map((p) => (p.id === tempId ? data : p)));
      }
    } catch {}
  };

  const votePick = async (pick: any, val: number) => {
    const currentVotes = { ...(pick.votes || {}) };
    currentVotes[nick] = currentVotes[nick] === val ? 0 : val;
    if (currentVotes[nick] === 0) delete currentVotes[nick];

    const totalVoters = Math.max(1, onlineUsers.length);
    const up = Object.values(currentVotes).filter((v: any) => v > 0).length;
    const down = Object.values(currentVotes).filter((v: any) => v < 0).length;

    let status = pick.status;
    const majorityThreshold = Math.ceil(totalVoters / 2);
    if (up >= majorityThreshold && up > down) {
      status = "confirmed";
      showToast(`🎉 Proposta approvata a maggioranza! Aggiunta alla Schedina Squad.`);
    } else if (down >= majorityThreshold && down > up) {
      status = "rejected";
    }

    setPicks((prev) => prev.map((p) => (p.id === pick.id ? { ...p, votes: currentVotes, status } : p)));
    try {
      await supabase.from("room_picks").update({ votes: currentVotes, status }).eq("id", pick.id);
    } catch {}
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
    try {
      await supabase.from("room_picks").delete().eq("id", id);
    } catch {}
    showToast("🗑️ Quota rimossa");
  };

  const confirmed = picks.filter((p) => p.status === "confirmed");
  const pending = picks.filter((p) => p.status === "pending");
  const historyPicks = picks.filter((p) => p.status === "confirmed" || p.status === "rejected");

  const activeSheetItems = betMode === "voto" ? picks : confirmed;

  const rawMultiplier = activeSheetItems.reduce((acc, p) => acc * Number(p.odds), 1);
  const totalOdds = activeSheetItems.length > 0 ? (Math.round(rawMultiplier * 100) / 100).toFixed(2) : "0.00";

  const qualifyingEvents = activeSheetItems.filter((p) => Number(p.odds) >= 1.25).length;
  const bonusPct = qualifyingEvents >= 5 ? (qualifyingEvents - 4) * 5 : 0;
  const bonusMultiplier = 1 + bonusPct / 100;

  const rawPotentialWin = activeSheetItems.length > 0 ? Number(stake) * Number(totalOdds) * bonusMultiplier : 0;
  const isCapped = rawPotentialWin > 50000;
  const potentialWin = activeSheetItems.length > 0 ? (Math.min(50000, Math.round(rawPotentialWin * 100) / 100)).toFixed(2) : "0.00";

  const safeParticipants = Math.max(1, participantsCount);
  const stakePerHead = activeSheetItems.length > 0 ? (stake / safeParticipants).toFixed(2) : "0.00";
  const winPerHead = (Number(potentialWin) / safeParticipants).toFixed(2);

  const bookmakersConfig = [
    { name: "Sisal.it", logo: "🟢", bonus: 1.05, link: "https://www.sisal.it", supportedMarkets: ["1X2", "Doppia Chance", "Under/Over", "Goal/NoGoal", "Multigoal", "Combo 1X2 + U/O", "Risultato Esatto"] },
    { name: "Snai.it", logo: "🔵", bonus: 1.04, link: "https://www.snai.it", supportedMarkets: ["1X2", "Doppia Chance", "Under/Over", "Goal/NoGoal", "Multigoal", "Marcatore", "Corner U/O"] },
    { name: "GoldBet", logo: "🟡", bonus: 1.03, link: "https://www.goldbet.it", supportedMarkets: ["1X2", "Doppia Chance", "Under/Over", "Goal/NoGoal", "Multigoal", "Cartellini U/O"] },
    { name: "Bet365", logo: "🟠", bonus: 1.06, link: "https://www.bet365.it", supportedMarkets: ["1X2", "Doppia Chance", "Under/Over", "Goal/NoGoal", "Multigoal", "Marcatore", "Risultato Esatto", "Corner U/O", "Cartellini U/O", "Monitor VAR"] },
    { name: "Eurobet", logo: "🔵", bonus: 1.02, link: "https://www.eurobet.it", supportedMarkets: ["1X2", "Doppia Chance", "Under/Over", "Goal/NoGoal", "Multigoal", "1X2 1° Tempo"] }
  ];

  const evaluatedBookmakers = useMemo(() => {
    return bookmakersConfig.map((b) => {
      const supportsAll = activeSheetItems.every((c) => b.supportedMarkets.some(m => c.market.includes(m) || m.includes(c.market)));
      const rawPayout = Number(potentialWin) * b.bonus;
      const finalPayout = Math.min(50000, Math.round(rawPayout * 100) / 100);
      return {
        ...b,
        supportsAll,
        finalPayout: finalPayout.toFixed(2)
      };
    }).sort((x, y) => Number(y.finalPayout) - Number(x.finalPayout));
  }, [activeSheetItems, potentialWin]);

  const copyForWhatsApp = () => {
    const text = `🔥 BetSquad [${roomId}]\n` +
      `📌 Sessione: ${roomName}\n` +
      `⚙️ Regole: ${betMode === "libera" ? "Libera" : "A Voto"}\n` +
      `👥 Partecipanti: ${safeParticipants} (${stakePerHead}€ a testa)\n` +
      `📌 Pronostici (${activeSheetItems.length}):\n` +
      activeSheetItems.map((c) => `• ${c.match_label}: ${c.selection} [${c.market}] @${Number(c.odds).toFixed(2)}`).join("\n") +
      `\n\n💰 Quota Totale: @${totalOdds}` +
      (bonusPct > 0 ? `\n🎁 Bonus Multipla: +${bonusPct}%` : "") +
      `\n💵 Puntata: ${stake}€ (Vincita a testa: ${winPerHead}€)` +
      `\n🏆 Vincita Totale: ${potentialWin}€` + (isCapped ? " (Massimale € 50.000)" : "") +
      `\n🔗 Entra nella stanza: ${window.location.href}`;

    navigator.clipboard.writeText(text);
    showToast("📋 Schedina copiata per WhatsApp!");
  };

  const shareRoomLink = () => {
    const shareData = {
      title: "BetSquad - Schedina Condivisa",
      text: `Unisciti alla mia stanza su BetSquad per costruire la schedina insieme! [Stanza: ${roomId}]`,
      url: window.location.href
    };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      showToast("🔗 Link stanza copiato negli appunti!");
    }
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
    if (activeSheetItems.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "italic 40px sans-serif";
      ctx.fillText("Nessun pronostico inserito", 140, yPos);
    } else {
      activeSheetItems.slice(0, 8).forEach((c, idx) => {
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 34px sans-serif";
        const label = c.match_label.length > 24 ? c.match_label.substring(0, 22) + "..." : c.match_label;
        ctx.fillText(`${idx + 1}. ${label}`, 120, yPos);

        ctx.fillStyle = "#0084ff";
        ctx.font = "bold 28px sans-serif";
        const cleanMarket = c.market.length > 12 ? c.market.substring(0, 10) + ".." : c.market;
        ctx.fillText(`Pronostico: ${c.selection} [${cleanMarket}]`, 120, yPos + 44);

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

  const competitions = [
    { name: "Serie A TIM", code: "IT", region: "Italia" },
    { name: "Premier League", code: "EN", region: "Inghilterra" },
    { name: "LaLiga", code: "ES", region: "Spagna" },
    { name: "Bundesliga", code: "DE", region: "Germania" },
    { name: "Champions League", code: "EU", region: "Europa" }
  ];

  const filteredCompetitions = useMemo(() => {
    return competitions.filter(c => c.name.toLowerCase().includes(searchLeagueQuery.toLowerCase()));
  }, [searchLeagueQuery]);

  const detailCategories = [
    "PRINCIPALI", "COMBO", "MULTIGOAL", "GIOCATORI", "MULTI GIOCATORI",
    "TEMPI", "CASA/OSPITE", "GOAL", "RISULTATI", "CORNER", "SANZIONI",
    "MINUTI", "SPECIALI MATCH", "STATS MATCH", "MONITOR VAR"
  ];

  const getMarketsForMatch = (m: any, category: string) => {
    const base1 = Number(m.odds1X2?.["1"] || 2.10);
    const baseX = Number(m.odds1X2?.["X"] || 3.25);
    const base2 = Number(m.odds1X2?.["2"] || 3.40);

    switch (category) {
      case "PRINCIPALI":
        return [
          { title: "Esito Finale 1X2", market: "1X2", cols: 3, items: [{ label: "1", odds: base1 }, { label: "X", odds: baseX }, { label: "2", odds: base2 }] },
          { title: "Doppia Chance", market: "Doppia Chance", cols: 3, items: [{ label: "1X", odds: Number(m.oddsDC?.["1X"] || 1.30) }, { label: "12", odds: Number(m.oddsDC?.["12"] || 1.32) }, { label: "X2", odds: Number(m.oddsDC?.["X2"] || 1.68) }] },
          { title: "Under / Over 2.5", market: "Under/Over", cols: 2, items: [{ label: "Under 2.5", odds: Number(m.oddsUO?.["Under 2.5"] || 1.85) }, { label: "Over 2.5", odds: Number(m.oddsUO?.["Over 2.5"] || 1.95) }] },
          { title: "Goal / NoGoal", market: "Goal/NoGoal", cols: 2, items: [{ label: "Goal", odds: Number(m.oddsGG?.["Goal"] || 1.75) }, { label: "NoGoal", odds: Number(m.oddsGG?.["NoGoal"] || 2.05) }] }
        ];
      case "COMBO":
        return [
          { title: "1X2 + Under/Over 2.5", market: "Combo 1X2 + U/O", cols: 3, items: [{ label: "1 + Over 2.5", odds: Number((base1 * 1.55).toFixed(2)) }, { label: "X + Over 2.5", odds: Number((baseX * 2.10).toFixed(2)) }, { label: "2 + Over 2.5", odds: Number((base2 * 1.60).toFixed(2)) }] }
        ];
      case "MULTIGOAL":
        return [
          { title: "Multigoal Totali", market: "Multigoal", cols: 3, items: [{ label: "1-3 Goal", odds: 1.42 }, { label: "2-4 Goal", odds: 1.50 }, { label: "2-5 Goal", odds: 1.33 }] }
        ];
      default:
        return [
          { title: `Opzioni ${category}`, market: category, cols: 2, items: [{ label: "Esito A", odds: 1.85 }, { label: "Esito B", odds: 1.90 }] }
        ];
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] pb-44 font-sans antialiased select-none">
      <canvas ref={canvasRef} className="hidden" />

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0084ff] text-white text-[11px] font-bold px-4 py-2 rounded-full shadow-2xl border border-white/20 flex items-center gap-1.5 animate-bounce">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{toast}</span>
        </div>
      )}

      {showInviteModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowInviteModal(false)}
        >
          <div 
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span className="font-black text-sm uppercase tracking-wider text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#0084ff]" /> Invita Amici
              </span>
              <button onClick={() => setShowInviteModal(false)} className="text-sm font-bold text-[var(--text-muted)] hover:text-white px-2 py-0.5 rounded bg-[var(--surface-quote)] cursor-pointer">✕</button>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Condividi il link della stanza <span className="font-mono text-[#0084ff] font-bold">[{roomId}]</span> per costruire la schedina insieme in tempo reale!
            </p>

            <div className="bg-[var(--surface-sub)] p-3 rounded-lg border border-[var(--border-subtle)] flex items-center justify-center">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`} 
                alt="QR Code Stanza"
                className="w-32 h-32 rounded bg-white p-1"
              />
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={shareRoomLink}
                className="w-full py-2.5 bg-[#0084ff] hover:bg-[#0073e6] text-white text-xs font-bold uppercase rounded-lg cursor-pointer flex items-center justify-center gap-2 shadow-sm transition"
              >
                <Share2 className="w-4 h-4" /> Condividi Link / WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

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
              <span className="font-black text-sm uppercase tracking-wider text-white flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#0084ff]" /> Regolamento Scommesse ADM
              </span>
              <button onClick={() => setShowRulesModal(false)} className="text-sm font-bold text-[var(--text-muted)] hover:text-white px-2 py-0.5 rounded bg-[var(--surface-quote)] cursor-pointer">✕</button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-[var(--text-muted)]">
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">1. Importi di Puntata e Vincita Massima</h4>
                <p>La puntata minima ammessa è di <strong>1,00 €</strong>. Il massimale di vincita per singolo biglietto è fissato a <strong>€ 50.000,00</strong> a norma di legge ADM.</p>
              </div>
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">2. Regola 1 Quota per Match</h4>
                <p>Nella multipla standard è ammessa una sola selezione per incontro. Scegliendo un nuovo mercato, il sistema effettua la sostituzione automatica.</p>
              </div>
              <div>
                <h4 className="font-bold text-white uppercase text-[11px]">3. Bonus Multipla Progressivo</h4>
                <p>Eventi con quota $\ge 1.25$ attivano il bonus dal 5° evento (+5%) con incremento incrementale.</p>
              </div>
            </div>

            <button onClick={() => setShowRulesModal(false)} className="w-full py-2 bg-[#0084ff] text-white text-xs font-bold uppercase rounded-lg cursor-pointer">Ho Capito</button>
          </div>
        </div>
      )}

      {detailMatch && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
          onClick={() => setDetailMatch(null)}
        >
          <div 
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl max-w-3xl w-full h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] p-3 sm:p-4 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-mono text-[#0084ff] uppercase font-bold tracking-wider">
                  {detailMatch.league || "Serie A TIM"} • PALINSESTO COMPLETO
                </span>
                <h3 className="text-sm sm:text-base font-black truncate text-white mt-0.5">
                  {detailMatch.home} <span className="text-[var(--text-muted)] font-normal">vs</span> {detailMatch.away}
                </h3>
              </div>
              <button onClick={() => setDetailMatch(null)} className="w-8 h-8 rounded-full bg-[var(--surface-quote)] flex items-center justify-center text-sm font-bold text-[var(--text-muted)] hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="bg-[var(--surface-sub)] border-b border-[var(--border-subtle)] px-2.5 py-2 overflow-x-auto flex gap-1.5 no-scrollbar shrink-0">
              {detailCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setDetailCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                    detailCategory === cat ? "bg-[#0084ff] text-white shadow-sm" : "bg-[var(--surface-quote)] text-[var(--text-muted)]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
              {getMarketsForMatch(detailMatch, detailCategory).map((group: any) => (
                <div key={group.title} className="bg-[var(--surface-header)] border border-[var(--border-subtle)] rounded-lg overflow-hidden shadow-sm">
                  <div className="bg-[var(--surface-sub)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    {group.title}
                  </div>
                  <div className={`p-2.5 grid gap-2 ${group.cols === 3 ? "grid-cols-3" : group.cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {group.items.map((item: any) => {
                      const selected = isSelected(detailMatch.id, item.label);
                      return (
                        <button
                          key={item.label}
                          onClick={() => handlePickAction(detailMatch, group.market, item.label, item.odds)}
                          className={`min-h-[46px] p-2 flex flex-col items-center justify-center rounded-lg border transition cursor-pointer active:scale-95 text-center ${
                            selected ? "bg-[#0084ff] border-white text-white shadow-md font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] border-[var(--border-subtle)] text-[var(--quote-val)]"
                          }`}
                        >
                          <span className="text-[11px] leading-tight text-[var(--text-muted)] font-semibold mb-0.5">{item.label}</span>
                          <span className="text-xs font-bold font-mono text-amber-400 tabular-nums">{item.odds.toFixed(2)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
            onClick={() => setShowInviteModal(true)}
            className="h-9 px-3 rounded-lg bg-[#0084ff] hover:bg-[#0073e6] text-white text-xs font-bold transition cursor-pointer shadow-sm flex items-center gap-1.5"
            title="Invita amici"
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Invita</span>
          </button>
          <button
            onClick={() => setShowRulesModal(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white transition cursor-pointer shadow-sm"
            title="Regolamento ADM"
          >
            <Scale className="w-4 h-4" />
          </button>
          <button
            onClick={exportStoryCard}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white transition cursor-pointer shadow-sm"
            title="Scarica Card Instagram"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--surface-quote)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white transition cursor-pointer shadow-sm"
            title="Cambia tema chiaro/scuro"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={copyForWhatsApp}
            className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg flex items-center justify-center cursor-pointer shadow-sm transition"
          >
            <span>Invia</span>
          </button>
        </div>
      </header>

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
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${betMode === "libera" ? "bg-[#0084ff] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-white"}`}
            >
              ⚡ Libera
            </button>
            <button
              onClick={() => toggleBetMode("voto")}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${betMode === "voto" ? "bg-[#0084ff] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-white"}`}
            >
              🗳️ A Voto
            </button>
          </div>
        ) : (
          <span className={`text-xs font-bold px-2 py-1 rounded ${betMode === "libera" ? "text-emerald-500 bg-emerald-500/10" : "text-amber-500 bg-amber-500/10"}`}>
            {betMode === "libera" ? "⚡ Libera" : "🗳️ A Voto"}
          </span>
        )}
      </div>

      <div className="bg-[var(--surface-header)] border-b border-[var(--border-subtle)] px-3 flex text-xs font-bold uppercase tracking-wider overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab("palinsesto")}
          className={`py-2 px-4 transition whitespace-nowrap border-b-2 cursor-pointer ${activeTab === "palinsesto" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"}`}
        >
          Palinsesto Quote
        </button>
        <button
          onClick={() => setActiveTab("voti")}
          className={`py-2 px-4 flex items-center gap-1.5 whitespace-nowrap border-b-2 cursor-pointer ${activeTab === "voti" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"}`}
        >
          Votazioni Live
          {pending.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-amber-500/20 text-amber-500 font-mono">
              {pending.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("schedina")}
          className={`py-2 px-4 flex items-center gap-1.5 whitespace-nowrap border-b-2 cursor-pointer ${activeTab === "schedina" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"}`}
        >
          Schedina Squad
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-500 font-mono">
            {confirmed.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("storico")}
          className={`py-2 px-4 flex items-center gap-1.5 whitespace-nowrap border-b-2 cursor-pointer ${activeTab === "storico" ? "text-[#0084ff] border-[#0084ff]" : "text-[var(--text-muted)] border-transparent"}`}
        >
          Storico Voti
        </button>
      </div>

      <main className="p-2 sm:p-4 w-full">
        {activeTab === "palinsesto" && (
          <div className="flex flex-col md:flex-row gap-3 items-start w-full">
            <aside className="hidden md:block w-64 shrink-0 bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 shadow-sm space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Cerca campionato..."
                  value={searchLeagueQuery}
                  onChange={(e) => setSearchLeagueQuery(e.target.value)}
                  className="w-full h-8 pl-8 pr-2 bg-[var(--surface-sub)] border border-[var(--border-subtle)] rounded text-xs text-[var(--text-main)] focus:outline-none focus:border-[#0084ff]"
                />
              </div>

              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] pb-1 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <span>Competizioni</span>
                <span className="text-[10px] text-[#0084ff] font-bold">CALCIO</span>
              </div>

              <div className="space-y-1">
                {filteredCompetitions.map((comp) => {
                  const isPinned = pinnedLeagues.includes(comp.name);
                  return (
                    <button
                      key={comp.name}
                      onClick={() => setSelectedLeague(comp.name)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-bold transition cursor-pointer ${
                        selectedLeague === comp.name ? "bg-[#0084ff] text-white shadow-sm" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] text-[var(--text-main)]"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/25">{comp.code}</span>
                        <span className="truncate">{comp.name}</span>
                      </span>
                      <span onClick={(e) => togglePinLeague(comp.name, e)} className="p-1 hover:opacity-100 opacity-60">
                        {isPinned ? <Pin className="w-3 h-3 fill-current text-amber-400" /> : <PinOff className="w-3 h-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="flex-1 min-w-0 w-full space-y-3">
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#0084ff] text-white">
                    {competitions.find(c => c.name === selectedLeague)?.code}
                  </span>
                  <span className="text-xs font-bold uppercase text-white tracking-wide">{selectedLeague}</span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 bg-[var(--bg-main)] p-1 rounded-lg border border-[var(--border-subtle)] w-full sm:w-auto overflow-x-auto">
                  {[{ id: "1X2", label: "Esito Finale 1x2" }, { id: "DC", label: "Doppia Chance" }, { id: "UO", label: "Under/Over" }, { id: "GG", label: "Goal/NoGoal" }, { id: "MG", label: "Multigoal" }].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMarketFilter(m.id as any)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap ${marketFilter === m.id ? "bg-[#0084ff] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-white"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-4 animate-pulse space-y-3">
                      <div className="h-4 bg-white/10 rounded w-1/4"></div>
                      <div className="flex justify-between items-center">
                        <div className="space-y-2 w-1/2">
                          <div className="h-3 bg-white/10 rounded w-3/4"></div>
                          <div className="h-3 bg-white/10 rounded w-1/2"></div>
                        </div>
                        <div className="flex gap-2">
                          <div className="w-16 h-10 bg-white/10 rounded"></div>
                          <div className="w-16 h-10 bg-white/10 rounded"></div>
                          <div className="w-16 h-10 bg-white/10 rounded"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : Object.keys(groupedMatches).length === 0 ? (
                <div className="text-center py-12 text-xs text-[var(--text-muted)] bg-[var(--surface-card)] rounded-lg border border-[var(--border-subtle)]">
                  Nessun match in programma per {selectedLeague}.
                </div>
              ) : (
                <div className="space-y-3 pb-8">
                  {Object.entries(groupedMatches).map(([dateLabel, matchList]) => (
                    <div key={`group_${dateLabel}`} className="bg-[var(--surface-header)] border border-[var(--border-subtle)] rounded-lg overflow-hidden shadow-sm">
                      <div className="bg-[var(--surface-sub)] px-3 py-1.5 text-xs font-bold flex items-center justify-between border-b border-[var(--border-subtle)]">
                        <span>📅 {dateLabel}</span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase">
                          {marketFilter === "1X2" ? "1 • X • 2" : marketFilter === "DC" ? "1X • 12 • X2" : marketFilter === "UO" ? "Over 2.5 • Under 2.5" : marketFilter === "GG" ? "Goal • NoGoal" : "1-3 • 2-4 • 2-5"}
                        </span>
                      </div>

                      <div className="divide-y divide-[var(--border-subtle)]">
                        {matchList.map((m) => {
                          const timeStr = new Date(m.commence_time).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

                          return (
                            <div key={`row_${m.id}`} className="p-3 flex items-center justify-between gap-2 relative">
                              <div 
                                onClick={() => { setDetailMatch(m); setDetailCategory("PRINCIPALI"); }}
                                className="min-w-0 flex-1 pr-2 cursor-pointer group select-none"
                                title="Clicca per aprire tutte le opzioni scommessa del match"
                              >
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{timeStr}</span>
                                  <span className="text-[9px] bg-[#0084ff]/15 text-[#0084ff] px-1.5 py-0.2 rounded font-bold uppercase group-hover:bg-[#0084ff] group-hover:text-white transition">
                                    +TUTTI I MERCATI ➔
                                  </span>
                                </div>
                                <div className="text-xs font-bold truncate group-hover:text-[#0084ff] transition">{m.home}</div>
                                <div className="text-xs font-bold truncate group-hover:text-[#0084ff] transition">{m.away}</div>
                              </div>

                              <div className="shrink-0 relative z-10">
                                {marketFilter === "1X2" && (
                                  <div className="grid grid-cols-3 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["1", "X", "2"] as const).map((lbl) => {
                                      const val = Number(m.odds1X2?.[lbl] || 2.0);
                                      const selected = isSelected(m.id, lbl);
                                      return (
                                        <button
                                          key={`btn_${m.id}_1X2_${lbl}`}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handlePickAction(m, "1X2", lbl, val); }}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer active:scale-95 select-none ${selected ? "bg-[#0084ff] border-white text-white shadow-sm font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] active:bg-[#0084ff]/20 border-[var(--border-subtle)] text-[var(--quote-val)]"}`}
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
                                      const selected = isSelected(m.id, lbl);
                                      return (
                                        <button
                                          key={`btn_${m.id}_DC_${lbl}`}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handlePickAction(m, "Doppia Chance", lbl, val); }}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer active:scale-95 select-none ${selected ? "bg-[#0084ff] border-white text-white shadow-sm font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] active:bg-[#0084ff]/20 border-[var(--border-subtle)] text-[var(--quote-val)]"}`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                                {marketFilter === "UO" && (
                                  <div className="grid grid-cols-2 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["Over 2.5", "Under 2.5"] as const).map((lbl) => {
                                      const val = Number(m.oddsUO?.[lbl] || 1.85);
                                      const selected = isSelected(m.id, lbl);
                                      return (
                                        <button
                                          key={`btn_${m.id}_UO_${lbl}`}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handlePickAction(m, "Under/Over", lbl, val); }}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer active:scale-95 select-none ${selected ? "bg-[#0084ff] border-white text-white shadow-sm font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] active:bg-[#0084ff]/20 border-[var(--border-subtle)] text-[var(--quote-val)]"}`}
                                        >
                                          <span className="text-[9px] text-[var(--text-muted)] leading-none">{lbl}</span>
                                          <span className="text-xs font-bold font-mono tabular-nums leading-tight">{val.toFixed(2)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                                {marketFilter === "GG" && (
                                  <div className="grid grid-cols-2 gap-1.5 w-[190px] sm:w-[220px]">
                                    {(["Goal", "NoGoal"] as const).map((lbl) => {
                                      const val = Number(m.oddsGG?.[lbl] || 1.8);
                                      const selected = isSelected(m.id, lbl);
                                      return (
                                        <button
                                          key={`btn_${m.id}_GG_${lbl}`}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handlePickAction(m, "Goal/NoGoal", lbl, val); }}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer active:scale-95 select-none ${selected ? "bg-[#0084ff] border-white text-white shadow-sm font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] active:bg-[#0084ff]/20 border-[var(--border-subtle)] text-[var(--quote-val)]"}`}
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
                                      const selected = isSelected(m.id, lbl);
                                      return (
                                        <button
                                          key={`btn_${m.id}_MG_${lbl}`}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handlePickAction(m, "Multigoal", lbl, val); }}
                                          className={`h-10 flex flex-col items-center justify-center rounded-md transition border cursor-pointer active:scale-95 select-none ${selected ? "bg-[#0084ff] border-white text-white shadow-sm font-black" : "bg-[var(--surface-quote)] hover:bg-[var(--surface-quote-hover)] active:bg-[#0084ff]/20 border-[var(--border-subtle)] text-[var(--quote-val)]"}`}
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

        {activeTab === "voti" && (
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 text-xs text-[var(--text-muted)] flex items-center justify-between">
              <span>🗳️ Regola di approvazione: <strong className="text-white">Maggioranza semplice (&gt;50% dei partecipanti online)</strong></span>
              <span className="font-mono text-emerald-400">Partecipanti: {onlineUsers.length || 1}</span>
            </div>

            {pending.length === 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-8 text-center text-xs text-[var(--text-muted)]">
                Nessuna proposta in attesa di voto al momento.
              </div>
            ) : (
              pending.map((p) => {
                const totalVoters = Math.max(1, onlineUsers.length);
                const votesObj = p.votes || {};
                const up = Object.values(votesObj).filter((v: any) => v > 0).length;
                const down = Object.values(votesObj).filter((v: any) => v < 0).length;
                const totalVoted = up + down;
                const pct = Math.round((totalVoted / totalVoters) * 100);

                return (
                  <div key={p.id} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-4 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="pr-2 truncate">
                        <div className="text-xs font-bold truncate text-white">{p.match_label}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Proposto da <span className="text-[#0084ff] font-bold">{p.proposed_by}</span> • <span className="text-white font-semibold">{p.selection}</span> ({p.market})
                        </div>
                      </div>
                      <div className="shrink-0">
                        <span className="font-mono font-bold text-amber-400 text-sm">@{Number(p.odds).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                        <span>Voti espressi: {totalVoted} / {totalVoters} ({pct}%)</span>
                        <span className="text-emerald-400 font-bold">Approvazione richiesta: {Math.floor(totalVoters / 2) + 1} 👍</span>
                      </div>
                      <div className="w-full bg-[var(--surface-sub)] h-2 rounded-full overflow-hidden border border-[var(--border-subtle)]">
                        <div className="bg-[#0084ff] h-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }}></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => votePick(p, 1)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer flex items-center gap-1 transition ${p.votes?.[nick] === 1 ? "bg-emerald-600 text-white shadow" : "bg-[var(--surface-quote)] text-[var(--text-muted)] hover:text-white"}`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" /> <span>{up}</span>
                        </button>
                        <button
                          onClick={() => votePick(p, -1)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer flex items-center gap-1 transition ${p.votes?.[nick] === -1 ? "bg-rose-600 text-white shadow" : "bg-[var(--surface-quote)] text-[var(--text-muted)] hover:text-white"}`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" /> <span>{down}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        {["🔥", "💣", "🔒", "🤡"].map((emoji) => {
                          const count = (p.reactions?.[emoji] || []).length;
                          const hasReacted = (p.reactions?.[emoji] || []).includes(nick);
                          return (
                            <button
                              key={emoji}
                              onClick={() => reactPick(p, emoji)}
                              className={`px-2 py-1 rounded border text-[11px] transition cursor-pointer ${hasReacted ? "bg-[#0084ff]/20 border-[#0084ff] text-white" : "bg-[var(--surface-quote)] border-[var(--border-subtle)] text-[var(--text-muted)]"}`}
                            >
                              {emoji} {count > 0 && <span className="font-mono font-bold ml-0.5">{count}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "storico" && (
          <div className="max-w-4xl mx-auto space-y-2">
            <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">📜 Storico Proposte e Voti Conclusi</div>
            {historyPicks.length === 0 ? (
              <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-8 text-center text-xs text-[var(--text-muted)]">
                Nessuno storico disponibile in questa sessione.
              </div>
            ) : (
              historyPicks.map((item) => (
                <div key={item.id} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 flex items-center justify-between text-xs">
                  <div className="space-y-0.5 truncate pr-2">
                    <div className="font-bold truncate text-white">{item.match_label}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {item.selection} ({item.market}) • Proposto da <span className="text-[#0084ff] font-semibold">{item.proposed_by}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-bold text-amber-400">@{Number(item.odds).toFixed(2)}</span>
                    {item.status === "confirmed" ? (
                      <span className="bg-emerald-500/15 text-emerald-400 text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Approvata
                      </span>
                    ) : (
                      <span className="bg-rose-500/15 text-rose-400 text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Bocciata
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "schedina" && (
          <div className="max-w-4xl mx-auto bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg p-3 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider">Schedina Squad ({confirmed.length} eventi)</span>
                <button onClick={() => setShowRulesModal(true)} className="text-[10px] text-[#0084ff] underline cursor-pointer">Regolamento ADM</button>
              </div>
              
              {/* Selezione Puntata (Bottoni rapidi + Input Libero senza 1€) */}
              <div className="flex items-center gap-1.5 bg-[var(--bg-main)] p-1 rounded border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)]">Puntata:</span>
                {[5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    onClick={() => setStake(val)}
                    className={`px-2 py-0.5 rounded text-xs font-bold cursor-pointer ${stake === val ? "bg-[#0084ff] text-white" : "text-[var(--text-muted)]"}`}
                  >
                    {val}€
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  max="50000"
                  value={stake}
                  onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
                  className="w-14 h-6 text-center bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded text-xs font-bold text-white focus:outline-none focus:border-[#0084ff]"
                  title="Inserisci importo libero"
                />
              </div>
            </div>

            {confirmed.length === 0 ? (
              <div className="text-center py-10 text-xs text-[var(--text-muted)]">
                Nessuna giocata in schedina. Approva i pronostici nel tab Votazioni o seleziona quote in modalità Libera.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="divide-y divide-[var(--border-subtle)]">
                  {confirmed.map((c) => (
                    <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div className="pr-2 truncate">
                        <div className="font-bold truncate text-white">{c.match_label}</div>
                        <div className="text-[11px] text-[#0084ff] font-semibold">{c.selection} ({c.market})</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-amber-400 text-sm">@{Number(c.odds).toFixed(2)}</span>
                        <button onClick={() => removePick(c.id)} className="text-rose-500 px-1 text-sm cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
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
                    </div>
                    <span className="text-2xl font-mono font-black text-emerald-400">{potentialWin} €</span>
                  </div>

                  {isCapped && (
                    <div className="bg-amber-500/15 border border-amber-500/30 text-amber-400 p-2.5 rounded-lg text-xs leading-relaxed font-semibold flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>La vincita potenziale è superiore al limite consentito (€ 50.000). Modifica il pronostico o la puntata.</span>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5 text-amber-400" /> Confronto Payout Bookmaker ADM ({stake}€):
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">Ordinati dal migliore</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {evaluatedBookmakers.map((b, idx) => (
                        <div
                          key={b.name}
                          className={`p-3 rounded-lg border transition flex flex-col justify-between gap-2 ${idx === 0 && b.supportsAll ? "bg-amber-500/10 border-amber-500/40 shadow-sm" : "bg-[var(--surface-sub)] border-[var(--border-subtle)]"}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white flex items-center gap-1.5">
                              <span>{b.logo}</span> {b.name}
                              {idx === 0 && b.supportsAll && (
                                <span className="bg-amber-400 text-black text-[9px] font-black px-1.5 py-0.2 rounded uppercase">Miglior Quota 🏆</span>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            {b.supportsAll ? (
                              <div className="flex flex-col">
                                <span className="text-sm font-mono font-bold text-emerald-400">
                                  {b.finalPayout} €
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)]">Bonus incluso</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Mercati parzialmente non disponibili
                              </span>
                            )}

                            <a
                              href={b.link}
                              target="_blank"
                              rel="noreferrer"
                              className={`h-7 px-3 rounded text-[10px] font-bold uppercase transition flex items-center gap-1 ${b.supportsAll ? "bg-[#0084ff] hover:bg-[#0073e6] text-white" : "bg-[var(--surface-quote)] text-[var(--text-muted)] hover:text-white"}`}
                            >
                              <span>Apri</span> <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] bg-[var(--surface-sub)] p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase">Partecipanti alla spesa:</span>
                      <select
                        value={participantsCount}
                        onChange={(e) => setParticipantsCount(Number(e.target.value))}
                        className="bg-[var(--bg-main)] text-xs font-bold border border-[var(--border-subtle)] rounded px-2.5 py-1 text-[var(--text-main)] cursor-pointer"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((num) => (
                          <option key={num} value={num}>
                            {num} {num === 1 ? "persona" : "persone"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center pt-1">
                      <div className="bg-[var(--surface-card)] p-2 rounded border border-[var(--border-subtle)]">
                        <span className="block text-[10px] text-[var(--text-muted)] uppercase">Quota a testa</span>
                        <span className="text-xs font-mono font-bold text-amber-400">{stakePerHead} €</span>
                      </div>
                      <div className="bg-[var(--surface-card)] p-2 rounded border border-[var(--border-subtle)]">
                        <span className="block text-[10px] text-[var(--text-muted)] uppercase">Vincita a testa</span>
                        <span className="text-xs font-mono font-bold text-emerald-400">{winPerHead} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {activeTab !== "schedina" && (
        <div className="fixed bottom-3 right-3 left-3 sm:left-auto sm:right-6 z-40 flex flex-col items-center sm:items-end pointer-events-none">
          {isSheetOpen && (
            <div className="w-full sm:w-[380px] bg-[var(--surface-card)] border border-[var(--border-strong)] rounded-xl shadow-2xl p-4 mb-2 pointer-events-auto max-h-[75vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  {betMode === "voto" ? `Voti & Proposte (${picks.length})` : `Anteprima Schedina (${confirmed.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => setIsSheetOpen(false)}
                  className="text-xs font-bold text-[var(--text-muted)] hover:text-white px-2 py-0.5 rounded bg-[var(--surface-quote)] cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {activeSheetItems.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                  Nessuna giocata presente. Clicca sulle quote in pagina per aggiungerle.
                </div>
              ) : (
                <div className="space-y-3 py-2">
                  <div className="divide-y divide-[var(--border-subtle)] max-h-48 overflow-y-auto">
                    {activeSheetItems.map((c) => (
                      <div key={c.id} className="py-2 flex items-center justify-between text-xs">
                        <div className="pr-2 truncate">
                          <div className="font-bold truncate text-white">{c.match_label}</div>
                          <div className="text-[10px] text-[#0084ff] font-semibold">{c.selection} ({c.market})</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono font-bold text-amber-400 text-xs">@{Number(c.odds).toFixed(2)}</span>
                          <button type="button" onClick={() => removePick(c.id)} className="text-rose-500 text-xs px-1 cursor-pointer">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2 text-xs">
                    {/* Puntata Libera personalizzata nell'Anteprima (Senza 1€) */}
                    <div className="flex items-center justify-between bg-[var(--surface-sub)] p-2 rounded gap-2">
                      <span className="text-[var(--text-muted)] uppercase font-bold text-[10px]">Puntata (€):</span>
                      <div className="flex items-center gap-1">
                        {[5, 10, 20, 50].map((val) => (
                          <button
                            key={val}
                            onClick={() => setStake(val)}
                            className={`px-2 py-0.5 rounded text-xs font-bold cursor-pointer ${stake === val ? "bg-[#0084ff] text-white" : "bg-[var(--surface-quote)] text-[var(--text-muted)]"}`}
                          >
                            {val}€
                          </button>
                        ))}
                        <input
                          type="number"
                          min="1"
                          max="50000"
                          value={stake}
                          onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
                          className="w-12 h-6 text-center bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded text-xs font-bold text-white focus:outline-none focus:border-[#0084ff]"
                          title="Inserisci importo libero"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-[var(--surface-sub)] p-2 rounded">
                      <span className="text-[var(--text-muted)] uppercase font-bold text-[10px]">Partecipanti:</span>
                      <select
                        value={participantsCount}
                        onChange={(e) => setParticipantsCount(Number(e.target.value))}
                        className="bg-[var(--bg-main)] text-xs font-bold border border-[var(--border-subtle)] rounded px-2 py-0.5 text-white cursor-pointer"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((num) => (
                          <option key={num} value={num}>{num} {num === 1 ? "persona" : "persone"}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-between text-xs pt-1">
                      <span className="text-[var(--text-muted)]">Quota totale: @{totalOdds}</span>
                      <span className="text-[var(--text-muted)]">Spesa a testa: <strong className="text-amber-400">{stakePerHead} €</strong></span>
                    </div>

                    <div className="flex justify-between items-baseline pt-1 border-t border-[var(--border-subtle)] text-emerald-400 font-mono font-black text-sm">
                      <span className="text-xs uppercase font-bold text-[var(--text-muted)]">Vincita Totale:</span>
                      <span>{potentialWin} €</span>
                    </div>

                    <div className="flex justify-between items-baseline text-emerald-400 font-mono font-bold text-xs bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                      <span className="uppercase text-[10px] text-emerald-300">Vincita a testa:</span>
                      <span className="text-sm font-black">{winPerHead} €</span>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => { setIsSheetOpen(false); setActiveTab(betMode === "voto" ? "voti" : "schedina"); }}
                        className="w-full h-10 bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 cursor-pointer shadow-md transition"
                      >
                        <span>{betMode === "voto" ? "Vai a Votazioni" : "Vai a Schedina Squad"}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsSheetOpen((prev) => !prev)}
            className="pointer-events-auto w-full sm:w-[380px] h-12 px-5 rounded-xl sm:rounded-full bg-[#0084ff] hover:bg-[#0073e6] active:bg-[#0060c0] text-white font-black text-xs uppercase tracking-wider shadow-2xl flex items-center justify-between cursor-pointer border border-white/20 transition-transform active:scale-95"
          >
            <div className="flex items-center gap-2">
              <span>ANTEPRIMA SCHEDINA</span>
              <span className="px-2 py-0.5 rounded-full bg-white/25 text-xs font-mono">
                {activeSheetItems.length}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono">
              <span className="text-amber-300">@{totalOdds}</span>
              <span>{isSheetOpen ? "▼" : "▲"}</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
