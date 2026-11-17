/**
 * Account guard, run every minute before any order (rule 0.1).
 *
 * Fail closed: anything missing, malformed or unexpected refuses. Three layers:
 *  1. The base URL is the paper constant (alpaca.ts). Paper keys only work on
 *     the paper host and live keys are refused there, so this is the decisive
 *     lock. The checks below catch the wrong *paper* account.
 *  2. The account number carries the paper prefix "PA". Alpaca does not
 *     document the format: this is a heuristic, confirmed on the real account
 *     at milestone 2, never the only check.
 *  3. Capital under 500 $ (the dedicated 50 € account) and, once day 0 is
 *     recorded, the exact account id pinned in D1.
 */

export const MAX_EQUITY_USD = 500;
export const PAPER_PREFIX = "PA";

export type GuardCode =
  | "malformed"
  | "not_paper_prefix"
  | "account_changed"
  | "status_not_active"
  | "trading_blocked"
  | "currency_not_usd"
  | "equity_invalid"
  | "equity_too_high";

export type GuardVerdict =
  | { readonly ok: true; readonly equityUsd: number; readonly accountTag: string }
  | { readonly ok: false; readonly code: GuardCode; readonly message: string; readonly accountTag: string };

/** Never log a full account number: keep the prefix and the last 2 characters. */
export function accountTag(accountNumber: unknown): string {
  if (typeof accountNumber !== "string" || accountNumber.length < 4) return "??";
  return accountNumber.slice(0, 2) + "…" + accountNumber.slice(-2);
}

function money(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string" && !/^-?\d+(\.\d+)?$/.test(v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Check the /v2/account payload. `pinnedAccountId` is the id recorded on day 0
 * (null before day 0 exists, e.g. during the very first setup tick).
 */
export function checkAccount(account: unknown, pinnedAccountId: string | null): GuardVerdict {
  if (account === null || typeof account !== "object") {
    return { ok: false, code: "malformed", message: "account payload missing", accountTag: "??" };
  }
  const a = account as Record<string, unknown>;
  const tag = accountTag(a["account_number"]);
  const refuse = (code: GuardCode, message: string): GuardVerdict => ({ ok: false, code, message, accountTag: tag });

  if (typeof a["id"] !== "string" || typeof a["account_number"] !== "string") {
    return refuse("malformed", "account id or number missing");
  }
  if (!a["account_number"].startsWith(PAPER_PREFIX)) {
    return refuse("not_paper_prefix", "account number does not carry the paper prefix");
  }
  if (pinnedAccountId !== null && a["id"] !== pinnedAccountId) {
    return refuse("account_changed", "this is not the dedicated Pile account recorded on day 0");
  }
  if (a["status"] !== "ACTIVE") {
    return refuse("status_not_active", "account status is " + String(a["status"]));
  }
  if (a["trading_blocked"] === true || a["account_blocked"] === true) {
    return refuse("trading_blocked", "the account is blocked at Alpaca");
  }
  if (a["currency"] !== "USD") {
    return refuse("currency_not_usd", "unexpected account currency");
  }
  const fields = ["equity", "last_equity", "cash", "portfolio_value"] as const;
  const values = fields.map((f) => money(a[f]));
  const equity = values[0];
  if (equity === null || equity === undefined || equity < 0) {
    return refuse("equity_invalid", "equity missing or invalid");
  }
  // The largest of the capital figures Alpaca reports must stay under the cap.
  const largest = Math.max(...values.filter((v): v is number => v !== null));
  if (!(largest < MAX_EQUITY_USD)) {
    return refuse("equity_too_high", "capital " + largest.toFixed(2) + " $ is not under " + MAX_EQUITY_USD + " $: not the dedicated 50 € account");
  }
  return { ok: true, equityUsd: equity, accountTag: tag };
}
