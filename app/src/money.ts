/**
 * Where the change since day 0 comes from (Système screen, brief 4.2):
 *   now − 50 € = (dollars now − dollars day 0) × rate now     ← trades
 *              + dollars day 0 × (rate now − rate day 0)        ← exchange rate
 *              + (dollars day 0 × rate day 0 − 50 €)            ← the deposit's rounding
 */
export interface Split {
  readonly total: number;
  readonly trades: number;
  readonly fx: number;
  readonly deposit: number;
}

export function splitChange(usdNow: number, rateNow: number, usd0: number, rate0: number, base = 50): Split {
  const trades = (usdNow - usd0) * rateNow;
  const fx = usd0 * (rateNow - rate0);
  const deposit = usd0 * rate0 - base;
  return { total: usdNow * rateNow - base, trades, fx, deposit };
}
