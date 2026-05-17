/** Entry point: fetch → aggregate → render → write generated/*.svg */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import {
  Octokit,
  fetchContributions,
  fetchLines,
  fetchViewer,
  fetchViews,
} from "./api.js";
import type { LanguageStat, ProfileStats } from "./models.js";
import { renderLanguages, renderOverview } from "./render.js";

const OTHER_COLOR = "#8b949e";

function aggregateLanguages(
  repos: { languages: { name: string; size: number; color: string | null }[] }[],
  excludeLangs: Set<string>,
  topN: number,
): LanguageStat[] {
  const totals = new Map<string, { size: number; color: string }>();
  for (const r of repos) {
    for (const l of r.languages) {
      if (excludeLangs.has(l.name)) continue;
      const cur = totals.get(l.name);
      if (cur) cur.size += l.size;
      else totals.set(l.name, { size: l.size, color: l.color ?? OTHER_COLOR });
    }
  }
  const grand = [...totals.values()].reduce((a, b) => a + b.size, 0);
  if (grand === 0) return [];

  const sorted = [...totals.entries()]
    .map(([name, v]) => ({ name, size: v.size, color: v.color }))
    .sort((a, b) => b.size - a.size);

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const stats: LanguageStat[] = top.map((t) => ({
    name: t.name,
    size: t.size,
    color: t.color,
    pct: (100 * t.size) / grand,
  }));
  if (rest.length > 0) {
    const restSize = rest.reduce((a, b) => a + b.size, 0);
    stats.push({
      name: "Other",
      size: restSize,
      color: OTHER_COLOR,
      pct: (100 * restSize) / grand,
    });
  }
  return stats;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const octokit = new Octokit({ auth: cfg.token });

  const viewer = await fetchViewer(octokit);

  const included = viewer.repos.filter((r) => {
    if (cfg.excludeRepos.has(r.nameWithOwner)) return false;
    if (cfg.ignoreForked && r.isFork) return false;
    return true;
  });

  const repoNames = included.map((r) => r.nameWithOwner);

  const [contributions, lines, views] = await Promise.all([
    fetchContributions(octokit),
    fetchLines(octokit, viewer.id, repoNames),
    fetchViews(octokit, repoNames),
  ]);

  const stars = included.reduce((a, r) => a + r.stargazerCount, 0);
  const forks = included.reduce((a, r) => a + r.forkCount, 0);
  const languages = aggregateLanguages(included, cfg.excludeLangs, cfg.topLangs);

  const stats: ProfileStats = {
    login: viewer.login,
    name: viewer.name,
    stars,
    forks,
    contributions,
    linesAdded: lines.added,
    linesDeleted: lines.deleted,
    views,
    repoCount: included.length,
    languages,
  };

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = resolve(root, "generated");
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "overview.svg"), renderOverview(stats), "utf8");
  await writeFile(
    resolve(outDir, "languages.svg"),
    renderLanguages(stats.languages),
    "utf8",
  );

  console.log(
    `Generated stats for ${stats.login}: ` +
      `stars=${stats.stars} forks=${stats.forks} ` +
      `contributions=${stats.contributions} ` +
      `lines=${stats.linesAdded + stats.linesDeleted} ` +
      `views=${stats.views} repos=${stats.repoCount} ` +
      `langs=${stats.languages.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
