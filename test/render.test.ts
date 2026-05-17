import { describe, expect, it } from "vitest";
import { renderLanguages, renderOverview } from "../src/render.js";
import type { LanguageStat, ProfileStats } from "../src/models.js";

const stats: ProfileStats = {
  login: "drader",
  name: "Oğuz Gençer",
  stars: 6,
  forks: 0,
  contributions: 526,
  linesAdded: 400000,
  linesDeleted: 214788,
  views: 102,
  repoCount: 24,
  languages: [],
};

const langs: LanguageStat[] = [
  { name: "TypeScript", size: 500, color: "#3178c6", pct: 50 },
  { name: "Python", size: 300, color: "#3572A5", pct: 30 },
  { name: "C", size: 200, color: "#555555", pct: 20 },
];

describe("renderOverview", () => {
  const svg = renderOverview(stats);

  it("is a valid-looking SVG document", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("renders the combined lines-changed total with grouping", () => {
    expect(svg).toContain("614,788");
  });

  it("includes core metrics and the name", () => {
    expect(svg).toContain("Oğuz Gençer — GitHub Statistics");
    expect(svg).toContain(">526<");
    expect(svg).toContain(">24<");
  });

  it("is theme-adaptive", () => {
    expect(svg).toContain("prefers-color-scheme: dark");
  });

  it("escapes XML-sensitive characters", () => {
    const evil = { ...stats, name: 'A & B <x>' };
    const out = renderOverview(evil);
    expect(out).toContain("A &amp; B &lt;x&gt;");
    expect(out).not.toContain("<x>");
  });
});

describe("renderLanguages", () => {
  const svg = renderLanguages(langs);

  it("renders one legend entry per language with percentages", () => {
    expect(svg).toContain("TypeScript");
    expect(svg).toContain("Python");
    expect(svg).toContain("C");
    expect(svg).toContain("50.0%");
  });

  it("uses each language colour in the stacked bar", () => {
    expect(svg).toContain("#3178c6");
    expect(svg).toContain("#3572A5");
  });

  it("is a valid-looking SVG document", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });
});
