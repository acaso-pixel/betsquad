export function calculatePoissonMarkets(q1: number, qX: number, q2: number) {
  const p1 = 1 / Math.max(1.01, q1);
  const p2 = 1 / Math.max(1.01, q2);
  const lh = +(p1 * 2.5).toFixed(2);
  const la = +(p2 * 2.1).toFixed(2);

  const pois = (k: number, l: number) => {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return (Math.pow(l, k) * Math.exp(-l)) / f;
  };

  const M: number[][] = [];
  for (let h = 0; h <= 5; h++) {
    M[h] = [];
    for (let a = 0; a <= 5; a++) {
      M[h][a] = pois(h, lh) * pois(a, la);
    }
  }

  const od = (prob: number) => Math.max(1.05, +(0.92 / Math.max(0.01, prob)).toFixed(2));

  let over25 = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      if (h + a > 2.5) over25 += M[h][a];
    }
  }

  return {
    uo: {
      "Over 2.5": od(over25),
      "Under 2.5": od(1 - over25),
    },
    combo: {
      "1 + Over 2.5": od(p1 * over25 * 1.15),
      "1 + Under 2.5": od(p1 * (1 - over25) * 0.85),
      "2 + Over 2.5": od(p2 * over25 * 1.15),
      "2 + Under 2.5": od(p2 * (1 - over25) * 0.85),
      "X + Under 2.5": od((1 / Math.max(1.01, qX)) * (1 - over25) * 1.1),
    },
    correctScore: {
      "1-0": od(M[1][0]),
      "2-0": od(M[2][0]),
      "2-1": od(M[2][1]),
      "0-0": od(M[0][0]),
      "1-1": od(M[1][1]),
      "0-1": od(M[0][1]),
      "0-2": od(M[0][2]),
      "1-2": od(M[1][2]),
    },
  };
}