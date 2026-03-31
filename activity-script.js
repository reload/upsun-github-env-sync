// @ts-check
/**
 * Upsun Activity Script: GitHub Deployment Synchronization
 *
 * Synchronizes Upsun environment states with GitHub Deployments API.
 * This script responds to environment lifecycle events and creates/updates
 * GitHub deployment statuses accordingly.
 *
 * Events handled:
 * - environment.push: Code pushed to environment
 * - environment.activate: Environment activated
 * - environment.redeploy: Environment redeployed
 * - environment.deactivate: Environment deactivated
 * - environment.delete: Environment deleted
 *
 * Required project variables:
 * - GH_TOKEN: GitHub personal access token with repo:deployments scope
 * - GH_REPO: GitHub repository in format "owner/repo"
 *
 * @file
 */

/**
 * @typedef {import("./types").UpsunContext} UpsunContext
 * @typedef {import("./types").UpsunValidatedContext} UpsunValidatedContext
 * @typedef {import("./types").UpsunActivity} UpsunActivity
 * @typedef {import("./types").UpsunValidatedActivity} UpsunValidatedActivity
 * @typedef {import("./types").UpsunStorage} UpsunStorage
 * @typedef {import("./types").GitHubDeployment} GitHubDeployment
 * @typedef {import("./types").GitHubDeploymentStatus} GitHubDeploymentStatus
 * @typedef {import("./types").GitHubDeploymentsResponse} GitHubDeploymentsResponse
 * @typedef {import("./types").GitHubBranchesWhereHeadResponse} GitHubBranchesWhereHeadResponse
 * @typedef {import("./types").GitHubPullRequest} GitHubPullRequest
 * @typedef {import("./types").UpsunRoute} UpsunRoute
 */

// ============================================================================
// Configuration Constants
// ============================================================================

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE = "https://api.github.com";

const UPSUN_ACTIVITY_DEPLOYMENT_STORAGE_KEY_PREFIX =
  "upsun-github-deployment-by-activity";
/** @type {UpsunStorage} */
// @ts-ignore Upsun injects this runtime module in activity scripts.
const storageApi = require("storage");

// ============================================================================
// Function Declarations
// ============================================================================

/**
 * Determine if this activity should be processed
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {boolean}
 */
function shouldProcessActivity(activity) {
  const environment = activity.environments[0] || "unknown";
  const environmentState = activity.payload?.environment?.status || "unknown";

  const supportedTypes = [
    "environment.push",
    "environment.activate",
    "environment.redeploy",
    "environment.domain.create",
    "environment.domain.delete",
    "environment.deactivate",
    "environment.delete",
  ];

  const supportedType = supportedTypes.includes(activity.type);
  const environmentInactive = environmentState === "inactive";

  const shouldProcess = supportedType && !environmentInactive;
  if (!shouldProcess) {
    console.log(
      `Not processing activity type: ${activity.type}, state: ${activity.state} for environment ${environment}, state ${environmentState}`,
    );
  }

  return shouldProcess;
}

/**
 * Validate required configuration from context
 * @param {UpsunContext} context
 * @returns {asserts context is UpsunValidatedContext}
 */
function validateContext(context) {
  if (!context.variables?.GH_TOKEN) {
    throw new Error("GH_TOKEN variable not set");
  }

  if (!context.variables?.GH_REPO) {
    throw new Error("GH_REPO variable not set");
  }

  if (!context.activity.project) {
    throw new Error("Project ID not available");
  }

  if (
    !context.activity.environments ||
    context.activity.environments.length === 0
  ) {
    throw new Error("Environment not available");
  }
}

/**
 * Process the activity and update GitHub deployment status
 * @param {UpsunValidatedContext} context
 * @returns {void}
 */
function processActivity(context) {
  console.log(
    `Processing activity: ${context.activity.type} (${context.activity.state}) for environment: ${context.activity.environments[0]}`,
  );

  // Determine what action to take based on activity type and state
  if (
    context.activity.type === "environment.deactivate" ||
    context.activity.type === "environment.delete"
  ) {
    if (context.activity.state === "complete") {
      handleEnvironmentDeactivation(context);
    }
  } else {
    handleEnvironmentDeployment(context);
  }
}

/**
 * Handle environment deactivation/deletion
 * @param {UpsunValidatedContext} context
 * @returns {void}
 */
function handleEnvironmentDeactivation(context) {
  const environment = context.activity.environments[0];
  console.log(`Marking deployment as inactive for environment: ${environment}`);

  // Get the latest deployment for this environment
  const deployment = getLatestDeployment(context);
  if (!deployment) {
    console.log("No deployment found to deactivate");
    return;
  }

  // Mark deployment as inactive
  createDeploymentStatus(context, deployment.id, {
    state: "inactive",
    description: "Environment closed",
  });

  console.log(`Deployment ${deployment.id} marked as inactive`);
}

/**
 * Handle environment deployment (push/activate/redeploy)
 * @param {UpsunValidatedContext} context
 * @returns {void}
 */
function handleEnvironmentDeployment(context) {
  const deployment = resolveDeploymentForActivity(context);
  const status = generateDeploymentStatus(context);
  createDeploymentStatus(context, deployment.id, status);
}

/**
 * Resolve the GitHub deployment to update for an activity.
 * For environment.push we create one deployment per Upsun activity and persist
 * the mapping in Upsun's storage API. Other activity types use the latest
 * deployment for the environment.
 * @param {UpsunValidatedContext} context
 * @returns {GitHubDeployment}
 */
function resolveDeploymentForActivity(context) {
  if (context.activity.type === "environment.push") {
    const existingDeploymentId = getStoredDeploymentIdForActivity(
      context.activity.id,
    );
    if (existingDeploymentId) {
      const existingDeployment = getDeploymentById(
        context,
        existingDeploymentId,
      );
      console.log(
        `Reusing deployment ${existingDeployment.id} for activity ${context.activity.id} (${context.activity.type})`,
        JSON.stringify(existingDeployment, null, 2),
      );
      return existingDeployment;
    } else {
      const deployment = createDeployment(context);
      storeDeploymentIdForActivity(context.activity.id, deployment.id);
      console.log(
        `Created and mapped deployment ${deployment.id} to activity ${context.activity.id} (${context.activity.type})`,
        JSON.stringify(deployment, null, 2),
      );
      return deployment;
    }
  }

  const latestDeployment = getLatestDeployment(context);
  if (latestDeployment) {
    console.log(
      `Retrieved latest deployment ${latestDeployment.id} for activity ${context.activity.id} (${context.activity.type})`,
      JSON.stringify(latestDeployment, null, 2),
    );
    return latestDeployment;
  }

  // We always expect to be able to determine a deployment for an activity. If
  // we cannot then we will have to create a new one we can work with.
  const deployment = createDeployment(context);
  console.log(
    `Created new deployment ${deployment.id} for activity ${context.activity.id} (${context.activity.type})`,
    JSON.stringify(deployment, null, 2),
  );
  return deployment;
}

/**
 * Resolve the storage key for an activity->deployment mapping.
 * @param {string} activityId
 * @returns {string}
 */
function getActivityDeploymentStorageKey(activityId) {
  return `${UPSUN_ACTIVITY_DEPLOYMENT_STORAGE_KEY_PREFIX}:${activityId}`;
}

/**
 * Load a deployment ID from Upsun storage for an activity.
 * @param {string} activityId
 * @returns {number|undefined}
 */
function getStoredDeploymentIdForActivity(activityId) {
  const key = getActivityDeploymentStorageKey(activityId);
  const value = storageApi.get(key);
  if (value === null || value === undefined || value === "") {
    console.log(`No stored deployment id found for activity ${activityId}`);
    return;
  }

  const deploymentId = Number.parseInt(String(value), 10);
  if (!Number.isInteger(deploymentId) || deploymentId <= 0) {
    console.log(
      `Ignoring invalid deployment id in storage for activity ${activityId}: ${value}`,
    );
    storageApi.remove(key);
    return;
  }

  console.log(
    `Found stored deployment id ${deploymentId} for activity ${activityId}`,
  );
  return deploymentId;
}

/**
 * Store a deployment ID in Upsun storage for an activity.
 * @param {string} activityId
 * @param {number} deploymentId
 * @returns {void}
 */
function storeDeploymentIdForActivity(activityId, deploymentId) {
  const key = getActivityDeploymentStorageKey(activityId);
  console.log(
    `Storing deployment id ${deploymentId} for activity ${activityId}`,
  );
  storageApi.set(key, String(deploymentId));
}

/**
 * Get the latest deployment for an environment
 * @param {UpsunValidatedContext} context
 * @returns {GitHubDeployment|undefined}
 */
function getLatestDeployment(context) {
  const environment = context.activity.environments[0];
  const url = `${GITHUB_API_BASE}/repos/${context.variables.GH_REPO}/deployments?environment=${environment}&per_page=1`;

  const response = fetchGitHub(context, url);

  /** @type {GitHubDeploymentsResponse} */
  const deployments = response.json();
  return deployments.shift();
}

/**
 * Get a deployment by ID.
 * @param {UpsunValidatedContext} context
 * @param {number} deploymentId
 * @returns {GitHubDeployment}
 */
function getDeploymentById(context, deploymentId) {
  const url = `${GITHUB_API_BASE}/repos/${context.variables.GH_REPO}/deployments/${deploymentId}`;

  const response = fetchGitHub(context, url);

  /** @type {GitHubDeployment} */
  const deployment = response.json();
  return deployment;
}

/**
 * Create a new GitHub deployment
 * @param {UpsunValidatedContext} context
 * @returns {GitHubDeployment}
 */
function createDeployment(context) {
  const environment = context.activity.environments[0];
  const url = `${GITHUB_API_BASE}/repos/${context.variables.GH_REPO}/deployments`;

  // Determine environment flags from Upsun environment type
  const upsunEnvType = context.activity.payload?.environment?.type || "";
  const isProduction = upsunEnvType === "production";

  // Resolve a branch ref whenever possible, with commit/environment fallbacks.
  const ref = getRef(context);

  const payload = {
    ref: ref,
    environment: environment,
    production_environment: isProduction,
    auto_merge: false,
    required_contexts: [], // Bypass status checks
  };

  const response = fetchGitHub(context, url, {
    method: "POST",
    body: payload,
  });

  /** @type {GitHubDeployment} */
  const deployment = response.json();
  console.log(
    `Created deployment ${deployment.id} for environment: ${environment}`,
    JSON.stringify(deployment, null, 2),
  );

  return deployment;
}

/**
 * Create a deployment status
 * @param {UpsunValidatedContext} context
 * @param {number} deploymentId - GitHub deployment ID
 * @param {GitHubDeploymentStatus} status - Deployment status to create
 */
function createDeploymentStatus(context, deploymentId, status) {
  const url = `${GITHUB_API_BASE}/repos/${context.variables.GH_REPO}/deployments/${deploymentId}/statuses`;

  fetchGitHub(context, url, {
    method: "POST",
    body: status,
  });

  console.log(
    `Updated deployment ${deploymentId} status to: ${status.state}`,
    JSON.stringify(status, null, 2),
  );
}

/**
 * Generate deployment status based on activity state and result
 * @param {UpsunValidatedContext} context
 * @returns {GitHubDeploymentStatus}
 */
function generateDeploymentStatus(context) {
  const logUrl = getLogUrl(context);

  // Activity is pending/starting
  if (context.activity.state === "pending") {
    return {
      state: "queued",
      description: "Deployment queued",
    };
  }

  // Activity is in progress
  if (context.activity.state === "in_progress") {
    return {
      state: "in_progress",
      description: "Deployment in progress",
      log_url: logUrl,
    };
  }

  // Activity is complete
  if (context.activity.state === "complete") {
    if (context.activity.result === "success") {
      const environmentUrl = getEnvironmentUrl(context.activity);
      return {
        state: "success",
        description: "Deployment successful",
        environment_url: environmentUrl,
        log_url: logUrl,
        auto_inactive: true, // Mark previous deployments as inactive
      };
    } else {
      return {
        state: "failure",
        description: "Deployment failed",
        log_url: logUrl,
      };
    }
  }

  // Default: queued
  return {
    state: "queued",
    description: "Deployment queued",
  };
}

/**
 * Returns the primary route from the deployment configuration.
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {{route: UpsunRoute, url: string}|{}}
 */
function getPrimaryRoute(activity) {
  const routes = activity.payload?.deployment?.routes;
  if (!routes) {
    return {};
  }
  return Object.entries(routes).reduce(
    (primary, [url, route]) => (route.primary ? { route, url } : primary),
    {},
  );
}

/**
 * Get the environment URL from Upsun routes
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {string|undefined}
 */
function getEnvironmentUrl(activity) {
  try {
    // Try to get primary route from deployment payload
    const primaryRoute = getPrimaryRoute(activity);
    if ("url" in primaryRoute) {
      return primaryRoute.url;
    }
    console.log(
      "Unable to determine url for environment",
      JSON.stringify(activity, null, 2),
    );
  } catch (error) {
    console.log("Error getting primary route:", error.message);
  }

  return undefined;
}

/**
 * Get the log url from an activity.
 * @param {UpsunValidatedContext} context
 * @return {string|undefined}
 */
function getLogUrl(context) {
  // The owner slug is not directly available in any of the provided properties
  // so we have to extract it.
  // Separate the first part of the path which contains the slug.
  const subscriptionManagementUri =
    context.project.subscription.subscription_management_uri;
  const matches = subscriptionManagementUri?.match(/\.com\/([^/]+)/);

  if (!matches?.[1]) {
    console.log(
      "Unable to determine Upsun owner organization from subscription_management_uri",
      subscriptionManagementUri,
    );
    return undefined;
  }

  const ownerSlug = matches[1];
  return `https://console.upsun.com/${ownerSlug}/${context.activity.project}/-/log/${context.activity.id}`;
}

/**
 * Get commit reference from activity payload
 * @param {UpsunValidatedActivity} activity - Upsun activity object
 * @returns {string|undefined}
 */
function getCommitSha(activity) {
  const commits = activity.payload?.commits || [];
  const lastCommit =
    commits.length > 0 ? commits[commits.length - 1] : undefined;

  if (typeof lastCommit === "string") {
    return lastCommit;
  }

  if (typeof lastCommit !== "string" && lastCommit?.sha) {
    return lastCommit.sha;
  }

  return activity.parameters?.new_commit;
}

/**
 * Lookup branches where the commit is currently HEAD.
 * @param {UpsunValidatedContext} context
 * @param {string} commitSha
 * @returns {string|undefined}
 */
function getBranchByHeadCommit(context, commitSha) {
  const url = `${GITHUB_API_BASE}/repos/${context.variables.GH_REPO}/commits/${encodeURIComponent(commitSha)}/branches-where-head`;

  const response = fetchGitHub(context, url);

  /** @type {GitHubBranchesWhereHeadResponse} */
  const branches = response.json();
  return branches.shift()?.name;
}

/**
 * Lookup the head branch name for a pull request.
 * Uses the GraphQL API to avoid fetching the full pull request payload which
 * can cause context cancellation timeouts in the Upsun runtime.
 * @param {UpsunValidatedContext} context
 * @param {number} pullNumber
 * @returns {string|undefined}
 */
function getBranchByPullRequest(context, pullNumber) {
  const [owner, repo] = context.variables.GH_REPO.split("/");
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefName
      }
    }
  }`;

  const response = fetchGitHub(context, `${GITHUB_API_BASE}/graphql`, {
    method: "POST",
    body: {
      query,
      variables: { owner, repo, number: pullNumber },
    },
  });

  const result = response.json();
  return result.data?.repository?.pullRequest?.headRefName;
}

/**
 * Resolve deployment ref from activity context.
 * @param {UpsunValidatedContext} context
 * @returns {string}
 */
function getRef(context) {
  const activity = context.activity;
  const commitSha = getCommitSha(activity);
  if (commitSha) {
    // Prefer branch name as ref over commit. This seems to work better for
    // issue to deployment mapping in JIRA.
    const branchByHeadCommit = getBranchByHeadCommit(context, commitSha);
    if (branchByHeadCommit) {
      console.log(`Using branch name ${branchByHeadCommit} as deployment ref`);
      return branchByHeadCommit;
    }

    console.log(`Using commit SHA ${commitSha} as deployment ref`);
    return commitSha;
  }

  // Try to resolve a branch from a pr-<number> environment name
  const environment = activity.environments[0];
  const prMatch = environment.match(/^pr-(\d+)$/);
  if (prMatch) {
    const branch = getBranchByPullRequest(context, Number(prMatch[1]));
    if (branch) {
      console.log(
        `Using branch name ${branch} environment name ${environment} as deployment ref`,
      );
      return branch;
    }
  }

  console.log(
    `Falling back to environment name ${environment} as deployment ref`,
  );
  return environment;
}

/**
 * Perform an authenticated request to the GitHub API.
 * @param {UpsunValidatedContext} context
 * @param {string} url
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Response|any}
 */
function fetchGitHub(context, url, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${context.variables.GH_TOKEN}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };

  const requestOptions = {
    method: options.method,
    headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  /** @type {Response|any} */
  const response = fetch(url, requestOptions);
  if (!response.ok) {
    const errorMessage = JSON.stringify({
      message: `GitHub API request for ${url} failed: (${response.status}) ${response.statusText}`,
      request: options.body,
      response: response.json(),
    });
    throw new Error(errorMessage);
  }
  return response;
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * @param {UpsunContext} context
 * @returns {void}
 */
function main(context) {
  "use strict";

  if (!shouldProcessActivity(context.activity)) {
    return;
  }

  validateContext(context);
  processActivity(context);
}

// @ts-ignore
main({ activity, variables, project });
