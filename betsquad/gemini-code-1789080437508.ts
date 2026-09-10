import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calculatePoissonMarkets } from '@/lib/poisson';

export const revalidate = 0; // Risposte dinamiche

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  const sportKey = 'soccer_italy_serie_a';

  // 1. Controlla Cache su Supabase
  const { data: cached } = await supabase
    .from('cached_odds')
    .select('*')
    .eq('sport_key', sportKey)
    .single();

  const now = new Date().getTime();
  const day = new Date().getDay();
  // Weekend (ven-dom): cache 2 ore (7200000ms). Lun-gio: cache 12 ore (43200000ms).
  const ttl = (day === 0 || day === 5 || day === 6) ? 7200000 : 43200000;

  if (cached && (now - new Date(cached.updated_at).getTime() < ttl)) {
    return NextResponse.json({ source: 'cache', matches: cached.data });
  }

  // 2. Se scaduta o assente, effettua fetch da The Odds API
  if (!apiKey) {
    return NextResponse.json({ error: 'ODDS_API_KEY mancante' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h`,
      { cache: 'no-store' }
    );
    const rawMatches = await res.json();

    if (!Array.isArray(rawMatches)) {
      return NextResponse.json({ error: 'Errore risposta provider', details: rawMatches }, { status: 502 });
    }

    // 3. Normalizza quote e arricchisci con Poisson
    const formatted = rawMatches.map((m: any) => {
      const bookie = m.bookmakers?.[0];
      const h2h = bookie?.markets?.find((x: any) => x.key === 'h2h');

      const q1 = h2h?.outcomes?.find((o: any) => o.name === m.home_team)?.price || 2.10;
      const q2 = h2h?.outcomes?.find((o: any) => o.name === m.away_team)?.price || 3.20;
      const qX = h2h?.outcomes?.find((o: any) => o.name === 'Draw')?.price || 3.10;

      const derived = calculatePoissonMarkets(q1, qX, q2);

      return {
        id: m.id,
        home: m.home_team,
        away: m.away_team,
        commence_time: m.commence_time,
        odds1X2: { "1": q1, "X": qX, "2": q2 },
        derived,
      };
    });

    // 4. Salva in cache
    await supabase.from('cached_odds').upsert({
      sport_key: sportKey,
      data: formatted,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ source: 'live', matches: formatted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}