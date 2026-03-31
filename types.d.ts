export interface UpsunUser {
  id: string;
  display_name: string;
}

export interface UpsunEnvironment {
  id: string;
  name: string;
  machine_name: string;
  type: string;
  head_commit: string;
  is_main: boolean;
  is_pr: boolean;
  status: string;
}

export interface UpsunCommit {
  sha: string;
  author: {
    email: string;
    name: string;
    date: number;
  };
  parents: string[];
  message: string;
}

export interface UpsunRoute {
  id: string;
  primary: boolean;
  type: string;
}

export interface UpsunDeployment {
  id: string;
  routes: Record<string, UpsunRoute>;
}

export interface UpsunActivityPayload {
  user: UpsunUser;
  environment: UpsunEnvironment;
  commits?: UpsunCommit[];
  commits_count?: number;
  deployment?: UpsunDeployment;
}

export interface UpsunActivityParameters {
  user?: string;
  environment?: string;
  old_commit?: string;
  new_commit?: string;
}

export interface UpsunActivity {
  id: string;
  type: string;
  state: string;
  result?: string;
  project: string;
  environments: string[];
  payload?: UpsunActivityPayload;
  parameters?: UpsunActivityParameters;
}

export interface UpsunValidatedActivity extends UpsunActivity {
  project: string;
  environments: [string, ...string[]];
}

export type UpsunVariables = Record<string, string>;

export type UpsunValidatedVariables = UpsunVariables & {
  GH_TOKEN: string;
  GH_REPO: string;
};

export interface UpsunProject {
  subscription: {
    subscription_management_uri?: string;
  };
}

export interface UpsunContext {
  activity: UpsunActivity;
  variables: UpsunVariables;
  project: UpsunProject;
}

export interface UpsunValidatedContext extends Omit<
  UpsunContext,
  "activity" | "variables"
> {
  activity: UpsunValidatedActivity;
  variables: UpsunValidatedVariables;
}

export interface UpsunStorage {
  get: (key: string) => string | null | undefined;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export interface GitHubDeployment {
  url: string;
  id: number;
  node_id: string;
  sha: string;
  ref: string;
  task: string;
  payload: Record<string, unknown> | string;
  original_environment?: string;
  environment: string;
  description: string | null;
  creator: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  statuses_url: string;
  repository_url: string;
  transient_environment: boolean;
  production_environment: boolean;
  performed_via_github_app?: Record<string, unknown> | null;
}

export interface GitHubDeploymentStatus {
  state: "queued" | "in_progress" | "success" | "failure" | "inactive";
  description?: string;
  log_url?: string;
  environment_url?: string;
  auto_inactive?: boolean;
}

export type GitHubDeploymentsResponse = GitHubDeployment[];

export interface GitHubBranchWhereHead {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export type GitHubBranchesWhereHeadResponse = GitHubBranchWhereHead[];

export interface GitHubPullRequestBranch {
  label: string;
  ref: string;
  sha: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  state: "open" | "closed";
  title: string;
  head: GitHubPullRequestBranch;
  base: GitHubPullRequestBranch;
}
