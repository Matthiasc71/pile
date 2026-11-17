/** Shapes of what comes back from Alpaca and Frankfurter. Anything else is refused, never guessed. */
import * as z from "zod/mini";

const num = z.pipe(
  z.union([z.number(), z.string().check(z.regex(/^-?\d+(\.\d+)?$/))]),
  z.transform((v: number | string) => Number(v)),
);

export const ClockSchema = z.object({
  timestamp: z.string(),
  is_open: z.boolean(),
  next_open: z.string(),
  next_close: z.string(),
});
export type AlpacaClock = z.infer<typeof ClockSchema>;

export const PositionSchema = z.object({
  symbol: z.string(),
  qty: num,
  side: z.string(),
  avg_entry_price: num,
  market_value: num,
  current_price: num,
  unrealized_pl: num,
  unrealized_plpc: num,
  asset_class: z.optional(z.string()),
});
export const PositionsSchema = z.array(PositionSchema);
export type AlpacaPosition = z.infer<typeof PositionSchema>;

export const BarSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.optional(z.number()),
  vw: z.optional(z.number()),
});
export const BarsResponseSchema = z.object({
  bars: z.nullable(z.record(z.string(), z.array(BarSchema))),
  next_page_token: z.optional(z.nullable(z.string())),
});
export type AlpacaBar = z.infer<typeof BarSchema>;

/** Frankfurter: /v1/latest or /v1/<start>.. with base=USD&symbols=EUR. */
export const FxLatestSchema = z.object({
  base: z.literal("USD"),
  date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  rates: z.object({ EUR: z.number().check(z.positive()) }),
});
export const FxSeriesSchema = z.object({
  base: z.literal("USD"),
  rates: z.record(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)), z.object({ EUR: z.number().check(z.positive()) })),
});
