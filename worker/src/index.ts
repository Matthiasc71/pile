/**
 * Pile's watcher: one Worker, one cron ("* * * * *"), the /api/* routes and
 * (milestone 3) the PWA as static assets.
 */
import { handleApi, json } from "./api";
import { defaultDeps, type Env } from "./env";
import { tick } from "./tick";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, Date.now());
    return json(404, { error: { code: "not_found", message: "rien ici" } });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env, controller.scheduledTime, defaultDeps).then((r) => {
        if (r.status !== "outside_window") console.log(JSON.stringify({ tick: r.status, subrequests: r.subrequests, detail: r.detail ?? null }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
