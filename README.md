# github-stats

Self-owned GitHub profile statistics generator. A small, clean-room TypeScript
project that queries the GitHub **GraphQL v4** API and renders two
theme-adaptive SVG cards committed back into this repository:

- `generated/overview.svg` — stars, forks, all-time contributions (private
  included), all-time lines of code changed, repository views, repo count
- `generated/languages.svg` — most-used languages with a stacked bar + legend

The cards are embedded in the profile README via raw URLs and refreshed daily
by a GitHub Action.

## Why GraphQL only

Line counts are derived from the user's own commit history
(`additions`/`deletions`) per repository over the GraphQL API, fully paginated.
This deliberately avoids the REST `/stats/contributors` endpoint, whose
asynchronous "202 still computing" responses make it slow and unreliable. The
only REST call is repository traffic views, which has no GraphQL equivalent.

## Usage

It runs as a scheduled GitHub Action (`.github/workflows/stats.yml`). Required
repository secret:

| Secret | Purpose |
|---|---|
| `ACCESS_TOKEN` | Classic PAT with `repo`, `read:user`, `user:email` scopes (needed for private contributions, line history and traffic views) |

Optional configuration via repository secrets / env:

| Name | Effect |
|---|---|
| `EXCLUDED` | Comma-separated `owner/repo` list to exclude from stats |
| `EXCLUDED_LANGS` | Comma-separated language names to exclude |
| `EXCLUDE_FORKED_REPOS` | `true` to skip forked repositories |
| `TOP_LANGS` | Number of languages before grouping into "Other" (default 8) |

### Local run

```bash
npm ci
ACCESS_TOKEN="$(gh auth token)" npm run generate   # writes generated/*.svg
npm run typecheck
npm test
```

## Structure

```
src/config.ts   environment configuration
src/api.ts      GitHub GraphQL/REST data layer (paginated, concurrency-bounded)
src/models.ts   domain types
src/render.ts   pure SVG renderers (unit-tested, no network)
src/index.ts    orchestration entry point
test/           vitest unit tests for the renderers
```

## License

MIT © 2026 Oğuz Gençer. Original work; contains no third-party source.
