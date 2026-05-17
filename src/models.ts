/** Domain types for the GitHub profile statistics generator. */

export interface RepoLang {
  name: string;
  size: number;
  color: string | null;
}

export interface Repo {
  nameWithOwner: string;
  isPrivate: boolean;
  isFork: boolean;
  stargazerCount: number;
  forkCount: number;
  languages: RepoLang[];
}

export interface LanguageStat {
  name: string;
  size: number;
  color: string;
  pct: number;
}

export interface ProfileStats {
  login: string;
  name: string;
  stars: number;
  forks: number;
  contributions: number;
  linesAdded: number;
  linesDeleted: number;
  views: number;
  repoCount: number;
  languages: LanguageStat[];
}
