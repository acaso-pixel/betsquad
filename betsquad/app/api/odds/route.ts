import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MOCK_SERIE_A = [
  { id: "1", home_team: "Inter", away_team: "Napoli", commence_time: new Date(Date.now() + 86400000).toISOString(), odds: { "1": 2.10, "X": 3.25, "2": 3.40 } },
  { id: "2", home_team: "Juventus", away_team: "Roma", commence_time: new Date(Date.now() + 172800000).toISOString(), odds: { "1": 1.95, "X": 3.30, "2": 3.80 } },
  { id: "3", home_team: "Milan", away_team: "Lazio", commence_time: new Date(Date.now() + 259200000).toISOString(), odds: { "1": 2.20, "X": 3.10, "2": 3.30 } }
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

    if (apiKey) {
      const oddsRes = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=eu&bookmakers=bet365,sisal,snai,goldbet,eurobet&markets=h2h,spreads,totals&oddsFormat=decimal`,
        { cache: "no-store" }
      );

      if (oddsRes.ok) {
        const rawMatches = await oddsRes.json();
        if (Array.isArray(rawMatches) && rawMatches.length > 0) {
          const formatted = rawMatches.map((m: any) => {
            const bookies = m.bookmakers || [];
            
            // Cerca le quote tra i bookmaker preferiti specificati
            const preferredBookie = bookies.find((b: any) => ["bet365", "sisal", "snai", "goldbet", "eurobet"].includes(b.key)) || bookies[0];
            const markets = preferredBookie?.markets || [];

            const h2hMarket = markets.find((x: any) => x.key === "h2h");
            const spreadsMarket = markets.find((x: any) => x.key === "spreads");
            const totalsMarket = markets.find((x: any) => x.key === "totals");

            const odds1X2: any = { "1": 2.0, "X": 3.2, "2": 3.4 };
            if (h2hMarket && Array.isArray(h2hMarket.outcomes)) {
              h2hMarket.outcomes.forEach((o: any) => {
                if (o.name === m.home_team) odds1X2["1"] = o.price;
                else if (o.name === m.away_team) odds1X2["2"] = o.price;
                else if (o.name === "Draw") odds1X2["X"] = o.price;
              });
            }

            const oddsDC: any = { "1X": 1.30, "12": 1.32, "X2": 1.68 };
            const oddsUO: any = { "Over 2.5": 1.95, "Under 2.5": 1.85 };
            if (totalsMarket && Array.isArray(totalsMarket.outcomes)) {
              totalsMarket.outcomes.forEach((o: any) => {
                if (o.point === 2.5) {
                  if (o.name === "Over") oddsUO["Over 2.5"] = o.price;
                  if (o.name === "Under") oddsUO["Under 2.5"] = o.price;
                }
              });
            }

            const oddsGG: any = { "Goal": 1.75, "NoGoal": 2.05 };
            const oddsMG: any = { "1-3 Goal": 1.42, "2-4 Goal": 1.50, "2-5 Goal": 1.33 };

            return {
              id: m.id,
              home: m.home_team,
              away: m.away_team,
              commence_time: m.commence_time,
              league: "Serie A TIM",
              odds1X2,
              oddsDC,
              oddsUO,
              oddsGG,
              oddsMG
            };
          });

          try {
            await supabase.from("cached_odds").upsert({
              sport_key: sportKey,
              data: formatted,
              updated_at: new Date().toISOString()
            });
          } catch {}

          return NextResponse.json({ source: "api", matches: formatted });
        }
      }
    }

    const mockFormatted = MOCK_SERIE_A.map((m) => ({
      id: m.id,
      home: m.home_team,
      away: m.away_team,
      commence_time: m.commence_time,
      league: "Serie A TIM",
      odds1X2: m.odds,
      oddsDC: { "1X": 1.30, "12": 1.32, "X2": 1.68 },
      oddsUO: { "Over 2.5": 1.95, "Under 2.5": 1.85 },
      oddsGG: { "Goal": 1.75, "NoGoal": 2.05 },
      oddsMG: { "1-3 Goal": 1.42, "2-4 Goal": 1.50, "2-5 Goal": 1.33 }
    }));

    return NextResponse.json({ source: "mock", matches: mockFormatted });
  } catch (err: any) {
    const mockFormatted = MOCK_SERIE_A.map((m) => ({
      id: m.id,
      home: m.home_team,
      away: m.away_team,
      commence_time: m.commence_time,
      league: "Serie A TIM",
      odds1X2: m.odds,
      oddsDC: { "1X": 1.30, "12": 1.32, "X2": 1.68 },
      oddsUO: { "Over 2.5": 1.95, "Under 2.5": 1.85 },
      oddsGG: { "Goal": 1.75, "NoGoal": 2.05 },
      oddsMG: { "1-3 Goal": 1.42, "2-4 Goal": 1.50, "2-5 Goal": 1.33 }
    }));
    return NextResponse.json({ source: "error_fallback", matches: mockFormatted });
  }
}
