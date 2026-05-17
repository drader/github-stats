/** GitHub data layer.
 *
 *  Strategy: everything via the GraphQL v4 API, including line counts which are
 *  derived from the user's own commit history (additions/deletions) per repo.
 *  This deliberately avoids the REST `/stats/contributors` endpoint, whose
 *  asynchronous 202 "still computing" responses make it unreliable. The only
 *  REST call is repository traffic views, which has no GraphQL equivalent.
 */

import { Octokit } from "octokit";
import type { Config } from "./config.js";
import type { Repo, RepoLang } from "./models.js";

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RepoNode {
  nameWithOwner: string;
  isPrivate: boolean;
  isFork: boolean;
  stargazerCount: number;
  forkCount: number;
  languages: { edges: { size: number; node: { name: string; color: string | null } }[] };
}

interface OverviewResponse {
  viewer: {
    login: string;
    name: string | null;
    id: string;
    repositories: { pageInfo: PageInfo; nodes: RepoNode[] };
    repositoriesContributedTo: { pageInfo: PageInfo; nodes: RepoNode[] };
  };
}

export interface Viewer {
  login: string;
  name: string;
  id: string;
  repos: Repo[];
}

const REPO_FIELDS = `
  nameWithOwner
  isPrivate
  isFork
  stargazerCount
  forkCount
  languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
    edges { size node { name color } }
  }
`;

const OVERVIEW_QUERY = `
query Overview($ownedAfter: String, $contribAfter: String) {
  viewer {
    login
    name
    id
    repositories(
      first: 100
      ownerAffiliations: OWNER
      isFork: false
      after: $ownedAfter
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { ${REPO_FIELDS} }
    }
    repositoriesContributedTo(
      first: 100
      includeUserRepositories: false
      contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW, REPOSITORY]
      after: $contribAfter
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { ${REPO_FIELDS} }
    }
  }
}`;

function toRepo(n: RepoNode): Repo {
  const languages: RepoLang[] = n.languages.edges.map((e) => ({
    name: e.node.name,
    size: e.size,
    color: e.node.color,
  }));
  return {
    nameWithOwner: n.nameWithOwner,
    isPrivate: n.isPrivate,
    isFork: n.isFork,
    stargazerCount: n.stargazerCount,
    forkCount: n.forkCount,
    languages,
  };
}

/** Fetch viewer identity plus owned and contributed repositories (paginated). */
export async function fetchViewer(octokit: Octokit): Promise<Viewer> {
  let ownedAfter: string | null = null;
  let contribAfter: string | null = null;
  let login = "";
  let name = "";
  let id = "";
  const seen = new Set<string>();
  const repos: Repo[] = [];

  for (let page = 0; page < 50; page++) {
    const data: OverviewResponse = await octokit.graphql<OverviewResponse>(
      OVERVIEW_QUERY,
      { ownedAfter, contribAfter },
    );
    const v = data.viewer;
    login = v.login;
    name = v.name ?? v.login;
    id = v.id;

    for (const node of [...v.repositories.nodes, ...v.repositoriesContributedTo.nodes]) {
      if (!node || seen.has(node.nameWithOwner)) continue;
      seen.add(node.nameWithOwner);
      repos.push(toRepo(node));
    }

    const more =
      v.repositories.pageInfo.hasNextPage ||
      v.repositoriesContributedTo.pageInfo.hasNextPage;
    if (!more) break;
    ownedAfter = v.repositories.pageInfo.endCursor ?? ownedAfter;
    contribAfter = v.repositoriesContributedTo.pageInfo.endCursor ?? contribAfter;
  }

  return { login, name, id, repos };
}

interface ContribYearsResponse {
  viewer: { contributionsCollection: { contributionYears: number[] } };
}

/** All-time contributions = sum of the yearly contribution calendars
 *  (includes private contributions when the profile setting allows it). */
export async function fetchContributions(octokit: Octokit): Promise<number> {
  const years = (
    await octokit.graphql<ContribYearsResponse>(
      `query { viewer { contributionsCollection { contributionYears } } }`,
    )
  ).viewer.contributionsCollection.contributionYears;

  if (years.length === 0) return 0;

  const aliases = years
    .map(
      (y) => `y${y}: contributionsCollection(
        from: "${y}-01-01T00:00:00Z"
        to: "${y + 1}-01-01T00:00:00Z"
      ) { contributionCalendar { totalContributions } }`,
    )
    .join("\n");

  const resp = await octokit.graphql<{
    viewer: Record<string, { contributionCalendar: { totalContributions: number } }>;
  }>(`query { viewer { ${aliases} } }`);

  let total = 0;
  for (const key of Object.keys(resp.viewer)) {
    total += resp.viewer[key]?.contributionCalendar.totalContributions ?? 0;
  }
  return total;
}

interface LinesResponse {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          pageInfo: PageInfo;
          nodes: ({ additions: number; deletions: number } | null)[];
        };
      } | null;
    } | null;
  } | null;
}

const LINES_QUERY = `
query Lines($owner: String!, $name: String!, $id: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, author: { id: $id }, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { additions deletions }
          }
        }
      }
    }
  }
}`;

async function linesForRepo(
  octokit: Octokit,
  authorId: string,
  fullName: string,
): Promise<[number, number]> {
  const slash = fullName.indexOf("/");
  if (slash < 0) return [0, 0];
  const owner = fullName.slice(0, slash);
  const name = fullName.slice(slash + 1);

  let added = 0;
  let deleted = 0;
  let after: string | null = null;

  for (let page = 0; page < 200; page++) {
    let data: LinesResponse;
    try {
      data = await octokit.graphql<LinesResponse>(LINES_QUERY, {
        owner,
        name,
        id: authorId,
        after,
      });
    } catch {
      break; // repo inaccessible / deleted / no default branch
    }
    const history = data.repository?.defaultBranchRef?.target?.history;
    if (!history) break;

    for (const c of history.nodes) {
      if (c) {
        added += c.additions;
        deleted += c.deletions;
      }
    }
    if (!history.pageInfo.hasNextPage || !history.pageInfo.endCursor) break;
    after = history.pageInfo.endCursor;
  }
  return [added, deleted];
}

/** Run async tasks with a bounded concurrency to avoid secondary rate limits. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function fetchLines(
  octokit: Octokit,
  authorId: string,
  repoNames: string[],
): Promise<{ added: number; deleted: number }> {
  const pairs = await mapLimit(repoNames, 6, (n) =>
    linesForRepo(octokit, authorId, n),
  );
  let added = 0;
  let deleted = 0;
  for (const [a, d] of pairs) {
    added += a;
    deleted += d;
  }
  return { added, deleted };
}

/** Repository traffic views (14-day window). REST-only; gracefully skips
 *  repositories the token cannot read traffic for. */
export async function fetchViews(
  octokit: Octokit,
  repoNames: string[],
): Promise<number> {
  const counts = await mapLimit(repoNames, 6, async (full) => {
    const slash = full.indexOf("/");
    if (slash < 0) return 0;
    const owner = full.slice(0, slash);
    const repo = full.slice(slash + 1);
    try {
      const r = await octokit.rest.repos.getViews({ owner, repo });
      return r.data.count ?? 0;
    } catch {
      return 0;
    }
  });
  return counts.reduce((a, b) => a + b, 0);
}

export { Octokit };
export type { Config };
