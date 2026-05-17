/** Environment-driven configuration. Secret names kept compatible with the
 *  previous setup so no GitHub secrets need to change. */

export interface Config {
  token: string;
  excludeRepos: Set<string>;
  excludeLangs: Set<string>;
  ignoreForked: boolean;
  topLangs: number;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function loadConfig(): Config {
  const token = process.env.ACCESS_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("ACCESS_TOKEN (or GH_TOKEN) environment variable is required");
  }

  const forked = (process.env.EXCLUDE_FORKED_REPOS ?? "").trim().toLowerCase();

  return {
    token,
    excludeRepos: csvSet(process.env.EXCLUDED),
    excludeLangs: csvSet(process.env.EXCLUDED_LANGS),
    ignoreForked: forked !== "" && forked !== "false",
    topLangs: Number(process.env.TOP_LANGS ?? 8),
  };
}
