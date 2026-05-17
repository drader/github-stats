/** SVG rendering — "Dashboard Grid" design, theme-adaptive (light/dark via
 *  prefers-color-scheme in a single SVG). Pure functions: given stats, return
 *  SVG strings. No network, no side effects (unit-testable). */

import type { LanguageStat, ProfileStats } from "./models.js";

const nf = new Intl.NumberFormat("en-US");

function num(n: number): string {
  return nf.format(n);
}

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const THEME = `
  :root {
    --bg: #ffffff; --border: #d0d7de; --tile: #f6f8fa;
    --fg: #1f2328; --muted: #656d76; --accent: #0969da;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --border: #30363d; --tile: #161b22;
      --fg: #e6edf3; --muted: #7d8590; --accent: #2f81f7;
    }
  }
  .card { fill: var(--bg); stroke: var(--border); }
  .tile { fill: var(--tile); stroke: var(--border); }
  .accent { fill: var(--accent); }
  .title { fill: var(--fg); font: 600 15px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  .num { fill: var(--fg); font: 700 21px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  .cap { fill: var(--muted); font: 400 11px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  .lg { fill: var(--fg); font: 400 12px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
`;

interface Tile {
  value: string;
  caption: string;
}

/** Overview card: 2x3 stat tiles with a thin accent bar — the "Dashboard
 *  Grid" direction. */
export function renderOverview(s: ProfileStats): string {
  const tiles: Tile[] = [
    { value: num(s.stars), caption: "Stars" },
    { value: num(s.forks), caption: "Forks" },
    { value: num(s.contributions), caption: "Contributions" },
    { value: num(s.linesAdded + s.linesDeleted), caption: "Lines changed" },
    { value: num(s.views), caption: "Views (14d)" },
    { value: num(s.repoCount), caption: "Repositories" },
  ];

  const W = 480;
  const H = 210;
  const tileW = 138;
  const tileH = 68;
  const gapX = 13;
  const x0 = 20;
  const cols = [x0, x0 + tileW + gapX, x0 + 2 * (tileW + gapX)];
  const rows = [46, 126];

  const cells = tiles
    .map((t, i) => {
      const x = cols[i % 3]!;
      const y = rows[Math.floor(i / 3)]!;
      return `
    <rect class="tile" x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="8"/>
    <rect class="accent" x="${x}" y="${y}" width="${tileW}" height="3" rx="1.5"/>
    <text class="num" x="${x + 14}" y="${y + 38}">${xml(t.value)}</text>
    <text class="cap" x="${x + 14}" y="${y + 56}">${xml(t.caption)}</text>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub statistics for ${xml(s.name)}">
  <style>${THEME}</style>
  <rect class="card" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10"/>
  <text class="title" x="20" y="30">${xml(s.name)} — GitHub Statistics</text>${cells}
</svg>
`;
}

/** Languages card: a stacked proportion bar + a two-column legend, matching
 *  the dashboard direction. */
export function renderLanguages(langs: LanguageStat[]): string {
  const W = 480;
  const barY = 50;
  const barH = 14;
  const barX = 20;
  const barW = W - 40;
  const rowH = 22;
  const legendTop = 84;
  const perCol = Math.ceil(langs.length / 2);
  const H = legendTop + perCol * rowH + 12;

  let cursor = barX;
  const segments = langs
    .map((l) => {
      const w = Math.max(0, (l.pct / 100) * barW);
      const seg = `<rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(
        2,
      )}" height="${barH}" fill="${xml(l.color)}"/>`;
      cursor += w;
      return seg;
    })
    .join("");

  const legend = langs
    .map((l, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = 20 + col * (barW / 2);
      const y = legendTop + row * rowH;
      return `
    <circle cx="${x + 6}" cy="${y - 4}" r="6" fill="${xml(l.color)}"/>
    <text class="lg" x="${x + 20}" y="${y}">${xml(l.name)}</text>
    <text class="cap" x="${x + (barW / 2) - 14}" y="${y}" text-anchor="end">${l.pct.toFixed(
      1,
    )}%</text>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Most used languages">
  <style>${THEME}</style>
  <rect class="card" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10"/>
  <text class="title" x="20" y="32">Most Used Languages</text>
  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="7"/></clipPath>
  <g clip-path="url(#bar)">${segments}<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="7" fill="none" stroke="var(--border)"/></g>${legend}
</svg>
`;
}
