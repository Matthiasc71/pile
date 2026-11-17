import { describe, expect, it, vi } from "vitest";
import { AlpacaError, DATA_BASE, PAPER_BASE, PaperLockError, dataUrl, marketData, trading, tradingUrl } from "../src/alpaca";

// Built from pieces so the repository never contains the live host (rule 0.1).
const LIVE_HOST = "api" + ".alpaca" + ".markets";
const KEYS = { keyId: "test-key-id", secretKey: "test-secret-value" };

describe("paper lock: trading URL", () => {
  it("is the paper constant", () => {
    expect(PAPER_BASE).toBe("https://paper-" + LIVE_HOST);
    expect(tradingUrl("/v2/account").href).toBe(PAPER_BASE + "/v2/account");
    expect(tradingUrl("/v2/orders?status=open&limit=50").origin).toBe(PAPER_BASE);
  });

  it.each([
    "https://" + LIVE_HOST + "/v2/orders",
    "//" + LIVE_HOST + "/v2/orders",
    "/v2//" + LIVE_HOST + "/orders",
    "/v2/../v2/orders",
    "/v2/%2e%2e/orders",
    "/v2/orders%2F..%2F",
    "\\\\" + LIVE_HOST + "/v2/orders",
    "v2/orders",
    "/v1/account",
    "/v2/orders#frag",
    "/v2/orders@evil.example",
    "",
  ])("refuses %s", (path) => {
    expect(() => tradingUrl(path)).toThrow(PaperLockError);
  });

  it("never reaches the network on a refused path", async () => {
    const fetcher = vi.fn();
    await expect(trading(fetcher, KEYS, "POST", "https://" + LIVE_HOST + "/v2/orders", {})).rejects.toThrow(PaperLockError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("market data URL", () => {
  it("allows read-only stock routes on the data host", () => {
    expect(dataUrl("/v2/stocks/bars?symbols=SPY,AMD&timeframe=1Min&feed=iex").origin).toBe(DATA_BASE);
  });

  it("refuses anything else", () => {
    expect(() => dataUrl("/v2/orders")).toThrow(PaperLockError);
    expect(() => dataUrl("/v2/account")).toThrow(PaperLockError);
  });
});

describe("calls", () => {
  it("sends keys only in headers, does not follow redirects", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await trading(fetcher, KEYS, "GET", "/v2/account");
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(PAPER_BASE + "/v2/account");
    expect(url.href).not.toContain(KEYS.secretKey);
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["APCA-API-SECRET-KEY"]).toBe(KEYS.secretKey);
  });

  it("treats a redirect as a paper lock violation", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://" + LIVE_HOST } }));
    await expect(trading(fetcher, KEYS, "GET", "/v2/account")).rejects.toThrow(PaperLockError);
  });

  it("reports Alpaca errors without leaking keys", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 40310000, message: "insufficient buying power" }), { status: 403 }));
    const err = await trading(fetcher, KEYS, "POST", "/v2/orders", { symbol: "AMD" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlpacaError);
    const e = err as AlpacaError;
    expect(e.status).toBe(403);
    expect(e.code).toBe("40310000");
    expect(e.message).toContain("insufficient buying power");
    expect(e.message).not.toContain(KEYS.secretKey);
    expect(e.message).not.toContain(KEYS.keyId);
  });

  it("market data is GET only", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await marketData(fetcher, KEYS, "/v2/stocks/bars?symbols=SPY");
    expect((fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1].method).toBe("GET");
  });
});
