import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { calculatePoissonMarkets } from "@/lib/poisson";

export const dynamic = "force-dynamic";

const MOCK_SERIE_A = [
  { id: "m1", home_team: "Inter", away_team: "Napoli", commence_time: new Date(Date.now() + 86400000).toISOString(), q1: 2.05, qX: 3.40, q2: 3.60 },
  { id: "m2", home_team: "Juventus", away_team: "Roma", commence_time: new Date(Date.now() + 172800000).toISOString(), q1: 2.15, qX: 3.25, q2: 3.50 },
  { id: "m3", home_team: "Milan", away_team: "Lazio", commence_time: new Date(Date.now() + 90000000).toISOString(), q1: 2.20, qX: 3.30, q2: 3.35 }
];

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  const sportKey = "soccer_italy_serie_a";

  try {
    const { data: cached } = await supabase
      .from("cached_odds")
      .select("*")
      .eq("sport_key", sportKey)
      .maybeSingle();

    const now = new Date().getTime();
    const day = new Date().getDay();
    const ttl = (day === 0 || day === 5 || day === 6) ? 7200000 : 43200000;

    if (cached && (now - new Date(cached.updated_at).getTime() < ttl)) {
      return NextResponse.json({ source: "cache", matches: cached.data });
    }

    if (!apiKey) {
      const mockFormatted = MOCK_SERIE_A.map((m) => ({
        id: m.id,
        home: m.home_team,
        away: m.away_team,
        commence_time: m.commence_time,
        odds1X2: { "1": m.q1, "X": m.qX, "2": m.q2 },
        derived: calculatePoissonMarkets(m.q1, m.qX, m.q2),
      }));
      return NextResponse.json({ source: "mock", matches: mockFormatted });
    }

    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h`,
      { cache: "no-store" }
    );
    const rawMatches = await res.json();

    if (!Array.isArray(rawMatches)) {
      throw new Error("Formato provider non valido");
    }

    const formatted = rawMatches.map((m: any) => {
      const bookie = m.bookmakers?.[0];
      const h2h = bookie?.markets?.find((x: any) => x.key === "h2h");

      const q1 = h2h?.outcomes?.find((o: any) => o.name === m.home_team)?.price || 2.10;
      const q2 = h2h?.outcomes?.find((o: any) => o.name === m.away_team)?.price || 3.20;
      const qX = h2h?.outcomes?.find((o: any) => o.name === "Draw")?.price || 3.10;

      return {
        id: m.id,
        home: m.home_team,
        away: m.away_team,
        commence_time: m.commence_time,
        odds1X2: { "1": q1, "X": qX, "2": q2 },
        derived: calculatePoissonMarkets(q1, qX, q2),
      };
    });

    try {
      await supabase.from("cached_odds").upsert({
        sport_key: sportKey,
        data: formatted,
        updated_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({ source: "live", matches: formatted });
  } catch (err: any) {
    const mockFallback = MOCK_SERIE_A.map((m) => ({
      id: m.id,
      home: m.home_team,
      away: m.away_team,
      commence_time: m.commence_time,
      odds1X2: { "1": m.q1, "X": m.qX, "2": m.q2 },
      derived: calculatePoissonMarkets(m.q1, m.qX, m.q2),
    }));
    return NextResponse.json({ source: "fallback", matches: mockFallback });
  }
}