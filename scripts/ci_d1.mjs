#!/usr/bin/env node
// CI only: find the "pile" D1 database (create it on the first deploy) and
// write its id into worker/wrangler.jsonc for this run. The id is not a
// secret; it only names the database inside the Cloudflare account.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "..", "worker");
const CONFIG = join(WORKER, "wrangler.jsonc");
const NAME = "pile";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { cwd: WORKER, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function findId() {
  const list = JSON.parse(wrangler(["d1", "list", "--json"]));
  const db = list.find((d) => d.name === NAME);
  return db ? db.uuid : null;
}

let id = findId();
if (!id) {
  console.log(`D1 "${NAME}" absente : création (région enam, près d'Alpaca à New York).`);
  wrangler(["d1", "create", NAME, "--location", "enam"]);
  id = findId();
}
if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
  console.error("Impossible de trouver l'identifiant de la base D1.");
  process.exit(1);
}
const text = readFileSync(CONFIG, "utf8");
if (!text.includes(PLACEHOLDER)) {
  console.error("wrangler.jsonc ne contient pas l'identifiant provisoire attendu.");
  process.exit(1);
}
writeFileSync(CONFIG, text.replace(PLACEHOLDER, id));
console.log(`D1 "${NAME}" : ${id}`);
