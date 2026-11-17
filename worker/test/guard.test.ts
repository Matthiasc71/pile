import { describe, expect, it } from "vitest";
import { MAX_EQUITY_USD, accountTag, checkAccount } from "../src/guard";

// The shape of GET /v2/account on a fresh paper account funded with ~50 €.
const PINNED = "0d9b6f3e-7c1a-4b8e-9f2d-5a6c7b8d9e01";
function account(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PINNED,
    account_number: "PA3XYZ123456",
    status: "ACTIVE",
    currency: "USD",
    cash: "57.94",
    portfolio_value: "57.94",
    equity: "57.94",
    last_equity: "57.94",
    trading_blocked: false,
    account_blocked: false,
    ...over,
  };
}

describe("account guard", () => {
  it("passes the dedicated paper account", () => {
    const v = checkAccount(account(), PINNED);
    expect(v).toEqual({ ok: true, equityUsd: 57.94, accountTag: "PA…56" });
  });

  it("passes before day 0 is pinned", () => {
    expect(checkAccount(account(), null).ok).toBe(true);
  });

  it("refuses an account without the paper prefix", () => {
    const v = checkAccount(account({ account_number: "3XYZ12345678" }), PINNED);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.code).toBe("not_paper_prefix");
  });

  it("refuses another paper account than the pinned one", () => {
    const v = checkAccount(account({ id: "another-id" }), PINNED);
    expect(!v.ok && v.code).toBe("account_changed");
  });

  it.each([
    ["equity", "500.00"],
    ["equity", "100000"],
    ["last_equity", "512.10"],
    ["cash", "800"],
    ["portfolio_value", "500"],
  ])("refuses capital that is not under 500 $ (%s = %s)", (field, value) => {
    const v = checkAccount(account({ [field]: value }), PINNED);
    expect(!v.ok && v.code).toBe("equity_too_high");
  });

  it("accepts 499.99 $", () => {
    expect(checkAccount(account({ equity: "499.99", last_equity: "499.99", cash: "499.99", portfolio_value: "499.99" }), PINNED).ok).toBe(true);
    expect(MAX_EQUITY_USD).toBe(500);
  });

  it.each([
    [null, "malformed"],
    ["text", "malformed"],
    [{ account_number: "PA1" }, "malformed"],
  ])("fails closed on a malformed payload", (payload, code) => {
    const v = checkAccount(payload, PINNED);
    expect(!v.ok && v.code).toBe(code);
  });

  it.each([
    [{ equity: undefined }, "equity_invalid"],
    [{ equity: "NaN" }, "equity_invalid"],
    [{ equity: "1e9" }, "equity_invalid"],
    [{ equity: "-1" }, "equity_invalid"],
    [{ status: "ACCOUNT_UPDATED" }, "status_not_active"],
    [{ trading_blocked: true }, "trading_blocked"],
    [{ account_blocked: true }, "trading_blocked"],
    [{ currency: "EUR" }, "currency_not_usd"],
  ])("fails closed on %o", (over, code) => {
    const v = checkAccount(account(over), PINNED);
    expect(!v.ok && v.code).toBe(code);
  });

  it("never exposes the full account number", () => {
    const v = checkAccount(account({ equity: "900" }), PINNED);
    expect(JSON.stringify(v)).not.toContain("PA3XYZ123456");
    expect(accountTag(undefined)).toBe("??");
  });
});
