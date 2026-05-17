#!/usr/bin/python3

import asyncio
import os
from typing import Dict, List, Optional, Set, Tuple, Any, cast

import aiohttp
import requests


###############################################################################
# Main Classes
###############################################################################


class Queries(object):
    """
    Class with functions to query the GitHub GraphQL (v4) API and the REST (v3)
    API. Also includes functions to dynamically generate GraphQL queries.
    """

    def __init__(
        self,
        username: str,
        access_token: str,
        session: aiohttp.ClientSession,
        max_connections: int = 10,
    ):
        self.username = username
        self.access_token = access_token
        self.session = session
        self.semaphore = asyncio.Semaphore(max_connections)

    async def query(self, generated_query: str, variables: Optional[Dict] = None) -> Dict:
        """
        Make a request to the GraphQL API using the authentication token from
        the environment
        :param generated_query: string query to be sent to the API
        :param variables: optional dict of variables for the GraphQL query
        :return: decoded GraphQL JSON output
        """
        headers = {
            "Authorization": f"Bearer {self.access_token}",
        }
        json_data = {"query": generated_query}
        if variables is not None:
            json_data["variables"] = variables

        try:
            async with self.semaphore:
                r_async = await self.session.post(
                    "https://api.github.com/graphql",
                    headers=headers,
                    json=json_data,
                )
            result = await r_async.json()
            if result is not None:
                return result
        except:
            print("aiohttp failed for GraphQL query")
            # Fall back on non-async requests
            async with self.semaphore:
                r_requests = requests.post(
                    "https://api.github.com/graphql",
                    headers=headers,
                    json=json_data,
                )
                result = r_requests.json()
                if result is not None:
                    return result
        return dict()

    async def query_rest(self, path: str, params: Optional[Dict] = None) -> Dict:
        """
        Make a request to the REST API (kept for project view stats)
        :param path: API path to query
        :param params: Query parameters to be passed to the API
        :return: deserialized REST JSON output
        """
        for _ in range(60):
            headers = {
                "Authorization": f"token {self.access_token}",
            }
            if params is None:
                params = dict()
            if path.startswith("/"):
                path = path[1:]
            try:
                async with self.semaphore:
                    r_async = await self.session.get(
                        f"https://api.github.com/{path}",
                        headers=headers,
                        params=tuple(params.items()),
                    )
                if r_async.status == 202:
                    print(f"A path returned 202. Retrying...")
                    await asyncio.sleep(2)
                    continue

                result = await r_async.json()
                if result is not None:
                    return result
            except:
                print("aiohttp failed for rest query")
                # Fall back on non-async requests
                async with self.semaphore:
                    r_requests = requests.get(
                        f"https://api.github.com/{path}",
                        headers=headers,
                        params=tuple(params.items()),
                    )
                    if r_requests.status_code == 202:
                        print(f"A path returned 202. Retrying...")
                        await asyncio.sleep(2)
                        continue
                    elif r_requests.status_code == 200:
                        return r_requests.json()
        print("There were too many 202s. Data for this repository will be incomplete.")
        return dict()

    @staticmethod
    def repos_overview(
        contrib_cursor: Optional[str] = None, owned_cursor: Optional[str] = None
    ) -> str:
        """
        :return: GraphQL query with overview of user repositories
        """
        return f"""{{
  viewer {{
    login,
    name,
    repositories(
        first: 100,
        orderBy: {{
            field: UPDATED_AT,
            direction: DESC
        }},
        isFork: false,
        after: {"null" if owned_cursor is None else '"'+ owned_cursor +'"'}
    ) {{
      pageInfo {{
        hasNextPage
        endCursor
      }}
      nodes {{
        name
        nameWithOwner
        stargazers {{
          totalCount
        }}
        forkCount
        languages(first: 10, orderBy: {{field: SIZE, direction: DESC}}) {{
          edges {{
            size
            node {{
              name
              color
            }}
          }}
        }}
      }}
    }}
    repositoriesContributedTo(
        first: 100,
        includeUserRepositories: false,
        orderBy: {{
            field: UPDATED_AT,
            direction: DESC
        }},
        contributionTypes: [
            COMMIT,
            PULL_REQUEST,
            REPOSITORY,
            PULL_REQUEST_REVIEW
        ]
        after: {"null" if contrib_cursor is None else '"'+ contrib_cursor +'"'}
    ) {{
      pageInfo {{
        hasNextPage
        endCursor
      }}
      nodes {{
        name
        nameWithOwner
        stargazers {{
          totalCount
        }}
        forkCount
        languages(first: 10, orderBy: {{field: SIZE, direction: DESC}}) {{
          edges {{
            size
            node {{
              name
              color
            }}
          }}
        }}
      }}
    }}
  }}
}}
"""

    @staticmethod
    def repo_lines_query() -> str:
        """
        GraphQL query for additions/deletions of the authenticated user in a
        specific repo. Paginated via `after` cursor so it covers the full
        commit history (not just the latest 100 commits).
        """
        return """
query($owner: String!, $name: String!, $authorId: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, author: {id: $authorId}, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              additions
              deletions
            }
          }
        }
      }
    }
  }
}
"""

    @staticmethod
    def user_id_query() -> str:
        """
        Retrieves the unique GraphQL ID of the viewer to filter commits accurately.
        """
        return """
query {
  viewer {
    id
  }
}
"""

    @staticmethod
    def contrib_years() -> str:
        return """
query {
  viewer {
    contributionsCollection {
      contributionYears
    }
  }
}
"""

    @staticmethod
    def contribs_by_year(year: str) -> str:
        return f"""
    year{year}: contributionsCollection(
        from: "{year}-01-01T00:00:00Z",
        to: "{int(year) + 1}-01-01T00:00:00Z"
    ) {{
      contributionCalendar {{
        totalContributions
      }}
    }}
"""

    @classmethod
    def all_contribs(cls, years: List[str]) -> str:
        by_years = "\n".join(map(cls.contribs_by_year, years))
        return f"""
query {{
  viewer {{
    {by_years}
  }}
}}
"""


class Stats(object):
    """
    Retrieve and store statistics about GitHub usage.
    """

    def __init__(
        self,
        username: str,
        access_token: str,
        session: aiohttp.ClientSession,
        exclude_repos: Optional[Set] = None,
        exclude_langs: Optional[Set] = None,
        ignore_forked_repos: bool = False,
    ):
        self.username = username
        self._ignore_forked_repos = ignore_forked_repos
        self._exclude_repos = set() if exclude_repos is None else exclude_repos
        self._exclude_langs = set() if exclude_langs is None else exclude_langs
        self.queries = Queries(username, access_token, session)

        self._user_id: Optional[str] = None
        self._name: Optional[str] = None
        self._stargazers: Optional[int] = None
        self._forks: Optional[int] = None
        self._total_contributions: Optional[int] = None
        self._languages: Optional[Dict[str, Any]] = None
        self._repos: Optional[Set[str]] = None
        self._lines_changed: Optional[Tuple[int, int]] = None
        self._views: Optional[int] = None

    async def to_str(self) -> str:
        languages = await self.languages_proportional
        formatted_languages = "\n  - ".join(
            [f"{k}: {v:0.4f}%" for k, v in languages.items()]
        )
        lines_changed = await self.lines_changed
        return f"""Name: {await self.name}
Stargazers: {await self.stargazers:,}
Forks: {await self.forks:,}
All-time contributions: {await self.total_contributions:,}
Repositories with contributions: {len(await self.repos)}
Lines of code added: {lines_changed[0]:,}
Lines of code deleted: {lines_changed[1]:,}
Lines of code changed: {lines_changed[0] + lines_changed[1]:,}
Project page views: {await self.views:,}
Languages:
  - {formatted_languages}"""

    async def get_user_id(self) -> str:
        """Fetch the unique global GraphQL ID of the user."""
        if self._user_id is not None:
            return self._user_id
        res = await self.queries.query(Queries.user_id_query())
        self._user_id = (
            ((res or {}).get("data") or {}).get("viewer", {}).get("id", "")
        )
        return self._user_id

    async def get_stats(self) -> None:
        self._stargazers = 0
        self._forks = 0
        self._languages = dict()
        self._repos = set()

        next_owned = None
        next_contrib = None
        while True:
            raw_results = await self.queries.query(
                Queries.repos_overview(
                    owned_cursor=next_owned, contrib_cursor=next_contrib
                )
            )
            raw_results = raw_results if raw_results is not None else {}

            self._name = (
                ((raw_results.get("data") or {}).get("viewer") or {}).get("name", None)
            )
            if self._name is None:
                self._name = (
                    ((raw_results.get("data") or {}).get("viewer") or {})
                    .get("login", "No Name")
                )

            contrib_repos = (
                ((raw_results.get("data") or {}).get("viewer") or {})
                .get("repositoriesContributedTo", {})
            )
            owned_repos = (
                ((raw_results.get("data") or {}).get("viewer") or {})
                .get("repositories", {})
            )

            repos = owned_repos.get("nodes", [])
            if not self._ignore_forked_repos:
                repos += contrib_repos.get("nodes", [])

            for repo in repos:
                if repo is None:
                    continue
                name = repo.get("nameWithOwner")
                if name in self._repos or name in self._exclude_repos:
                    continue
                self._repos.add(name)
                self._stargazers += repo.get("stargazers", {}).get("totalCount", 0)
                self._forks += repo.get("forkCount", 0)

                for lang in repo.get("languages", {}).get("edges", []):
                    name = lang.get("node", {}).get("name", "Other")
                    if name in self._exclude_langs:
                        continue
                    if name in self._languages:
                        self._languages[name]["size"] += lang.get("size", 0)
                        self._languages[name]["occurrences"] += 1
                    else:
                        self._languages[name] = {
                            "size": lang.get("size", 0),
                            "occurrences": 1,
                            "color": lang.get("node", {}).get("color"),
                        }

            if owned_repos.get("pageInfo", {}).get(
                "hasNextPage", False
            ) or contrib_repos.get("pageInfo", {}).get("hasNextPage", False):
                next_owned = owned_repos.get("pageInfo", {}).get(
                    "endCursor", next_owned
                )
                next_contrib = contrib_repos.get("pageInfo", {}).get(
                    "endCursor", next_contrib
                )
            else:
                break

        langs_total = sum([v.get("size", 0) for v in self._languages.values()])
        if langs_total > 0:
            for k, v in self._languages.items():
                v["prop"] = 100 * (v.get("size", 0) / langs_total)

    @property
    async def name(self) -> str:
        if self._name is not None:
            return self._name
        await self.get_stats()
        assert self._name is not None
        return self._name

    @property
    async def stargazers(self) -> int:
        if self._stargazers is not None:
            return self._stargazers
        await self.get_stats()
        assert self._stargazers is not None
        return self._stargazers

    @property
    async def forks(self) -> int:
        if self._forks is not None:
            return self._forks
        await self.get_stats()
        assert self._forks is not None
        return self._forks

    @property
    async def languages(self) -> Dict:
        if self._languages is not None:
            return self._languages
        await self.get_stats()
        assert self._languages is not None
        return self._languages

    @property
    async def languages_proportional(self) -> Dict:
        if self._languages is None:
            await self.get_stats()
            assert self._languages is not None
        return {k: v.get("prop", 0) for (k, v) in self._languages.items()}

    @property
    async def repos(self) -> Set[str]:
        if self._repos is not None:
            return self._repos
        await self.get_stats()
        assert self._repos is not None
        return self._repos

    @property
    async def total_contributions(self) -> int:
        if self._total_contributions is not None:
            return self._total_contributions

        self._total_contributions = 0
        years = (
            ((await self.queries.query(Queries.contrib_years())).get("data") or {})
            .get("viewer", {})
            .get("contributionsCollection", {})
            .get("contributionYears", [])
        )
        if not years:
            return 0

        by_year = (
            ((await self.queries.query(Queries.all_contribs(years))).get("data") or {})
            .get("viewer", {})
            .values()
        )
        for year in by_year:
            if year:
                self._total_contributions += year.get("contributionCalendar", {}).get(
                    "totalContributions", 0
                )
        return cast(int, self._total_contributions)

    @property
    async def lines_changed(self) -> Tuple[int, int]:
        """
        Fetch total lines added/deleted strictly via GraphQL by targeting the
        user's explicit commit history per repository. Fully paginated so it
        reflects the entire history, not just the latest 100 commits.
        """
        if self._lines_changed is not None:
            return self._lines_changed

        additions = 0
        deletions = 0
        author_id = await self.get_user_id()

        if not author_id:
            print("Could not retrieve GitHub Author Node ID. Skipping line stats.")
            self._lines_changed = (0, 0)
            return self._lines_changed

        repo_list = list(await self.repos)

        async def fetch_lines_for_repo(repo_fullname: str) -> Tuple[int, int]:
            if "/" not in repo_fullname:
                return 0, 0
            owner, name = repo_fullname.split("/", 1)

            repo_add = 0
            repo_del = 0
            after: Optional[str] = None
            # Safety bound: 200 pages * 100 commits = 20000 commits/repo
            for _ in range(200):
                res = await self.queries.query(
                    Queries.repo_lines_query(),
                    variables={
                        "owner": owner,
                        "name": name,
                        "authorId": author_id,
                        "after": after,
                    },
                )

                ref = (
                    ((res or {}).get("data") or {})
                    .get("repository", {})
                )
                ref = ref.get("defaultBranchRef") if isinstance(ref, dict) else None
                target = ref.get("target") if isinstance(ref, dict) else None
                history = target.get("history") if isinstance(target, dict) else None
                if not isinstance(history, dict):
                    break

                for commit in history.get("nodes", []):
                    if commit:
                        repo_add += commit.get("additions", 0)
                        repo_del += commit.get("deletions", 0)

                page_info = history.get("pageInfo", {}) or {}
                if page_info.get("hasNextPage"):
                    after = page_info.get("endCursor")
                    if not after:
                        break
                else:
                    break
            return repo_add, repo_del

        # Gather results concurrently across repositories
        results = await asyncio.gather(
            *[fetch_lines_for_repo(repo) for repo in repo_list]
        )

        for r_add, r_del in results:
            additions += r_add
            deletions += r_del

        self._lines_changed = (additions, deletions)
        return self._lines_changed

    @property
    async def views(self) -> int:
        """
        Note: only returns views for the last 14 days (as-per GitHub API)
        :return: total number of page views the user's projects have received
        """
        if self._views is not None:
            return self._views

        total = 0
        for repo in await self.repos:
            r = await self.queries.query_rest(f"/repos/{repo}/traffic/views")
            if isinstance(r, dict) and "views" in r:
                for view in r.get("views", []):
                    total += view.get("count", 0)

        self._views = total
        return total


###############################################################################
# Main Function
###############################################################################


async def main() -> None:
    access_token = os.getenv("ACCESS_TOKEN")
    user = os.getenv("GITHUB_ACTOR")
    if access_token is None or user is None:
        raise RuntimeError(
            "ACCESS_TOKEN and GITHUB_ACTOR environment variables cannot be None!"
        )
    async with aiohttp.ClientSession() as session:
        s = Stats(user, access_token, session)
        print(await s.to_str())


if __name__ == "__main__":
    asyncio.run(main())
