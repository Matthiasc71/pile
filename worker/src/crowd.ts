/**
 * Crowd index, part 1 (brief 5.5): the skill's popularity on GitHub, read by
 * the watcher once a day (Claude's sessions cannot reach api.github.com for
 * repositories outside the session). Public API, no token, one request a day.
 */
import type { FetchFn } from "./env";

export const SKILL_REPO_API = "https://api.github.com/repos/Jakeschincariol/day-trader-skill";

export async function fetchSkillPopularity(fetchFn: FetchFn): Promise<{ stars: number; forks: number }> {
  const res = await fetchFn(SKILL_REPO_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "pile-veilleur", "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "manual",
  });
  if (!res.ok) throw new Error("github: HTTP " + res.status);
  const d = (await res.json()) as { stargazers_count?: unknown; forks_count?: unknown };
  if (typeof d.stargazers_count !== "number" || typeof d.forks_count !== "number") throw new Error("github: réponse inattendue");
  return { stars: d.stargazers_count, forks: d.forks_count };
}
