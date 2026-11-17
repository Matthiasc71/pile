/**
 * Pile's watcher: one Worker, one cron ("* * * * *"), the /api/* routes and
 * (milestone 3) the PWA as static assets.
 */
import { defaultDeps, type Env } from "./env";
import { recordFailure, tick } from "./tick";
import { NY, zoned } from "./time";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Loaded on demand: the API (and zod) never costs the cron any CPU.
    const { handleApi, json } = await import("./api");
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, Date.now());
    return json(404, { error: { code: "not_found", message: "rien ici" } });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env, controller.scheduledTime, defaultDeps).then(
        (r) => {
          if (r.status !== "outside_window") console.log(JSON.stringify({ tick: r.status, subrequests: r.subrequests, detail: r.detail ?? null }));
        },
        async (e: unknown) => {
          console.error(JSON.stringify({ tick: "crash", error: e instanceof Error ? e.name + ": " + e.message : String(e) }));
          await recordFailure(env.DB, controller.scheduledTime, zoned(controller.scheduledTime, NY).date, "tick_crash", e);
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
