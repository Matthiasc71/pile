import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Builds the service worker (src/sw.ts) as /sw.js with the exact list of
 * files to precache and a version derived from their content, so a new
 * deploy replaces the cache and an unchanged one keeps it.
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "pile-sw",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    async closeBundle() {
      const { build } = await import("vite");
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push("/" + relative(outDir, p).split("\\").join("/"));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => !/\.(txt|map)$/.test(f) && f !== "/_headers" && f !== "/sw.js").sort();
      const version = createHash("sha256").update(precache.join("\n")).update(String(files.map((f) => statSync(join(outDir, f)).size))).digest("hex").slice(0, 12);
      await build({
        configFile: false,
        logLevel: "warn",
        define: { __PRECACHE__: JSON.stringify(precache), __VERSION__: JSON.stringify(version) },
        build: {
          outDir,
          emptyOutDir: false,
          minify: true,
          lib: { entry: "src/sw.ts", formats: ["es"], fileName: () => "sw.js" },
        },
      });
    },
  };
}

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { target: "safari16", assetsInlineLimit: 0, sourcemap: false },
  plugins: [serviceWorker()],
  test: { include: ["src/**/*.test.ts"] },
  server: {
    proxy: { "/api": process.env.PILE_API ?? "http://localhost:8788" },
  },
});
