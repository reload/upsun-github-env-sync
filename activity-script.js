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
 * - environment.deactivate: Environment deactivated
 * - environment.delete: Environment deleted
 *
 * Required project variables:
 * - GH_TOKEN: GitHub personal access token with repo:deployments scope
 * - GH_REPO: GitHub repository in format "owner/repo"
 *
 * @file
 */

// ============================================================================
// TypeScript Type Definitions (for validation and IDE support)
// ============================================================================

/**
 * @typedef {Object} UpsunContext
 * @property {UpsunActivity} activity - Activity payload object for the triggering event.
 * @property {UpsunVariables} variables - Variables exposed to the script execution context.
 * @property {UpsunProject} project - Project metadata available to the activity script.
 */

/**
 * @typedef {UpsunContext & {
 *   variables: UpsunValidatedVariables
 *   activity: UpsunValidatedActivity
 * }} UpsunValidatedContext
 */

/**
 * @typedef {Object} UpsunActivity
 * @property {string} id - Unique identifier for the activity
 * @property {string} type - Activity type (e.g., "environment.push")
 * @property {string} state - Activity state: "pending" | "in_progress" | "complete"
 * @property {string} [result] - Activity result: "success" | "failure" (only when state is "complete")
 * @property {string} project - Project ID
 * @property {string[]} environments - Array of environment names affected by this activity
 * @property {UpsunActivityPayload} [payload] - Detailed activity information
 * @property {UpsunActivityParameters} [parameters] - Activity parameters
 */

/**
 * @typedef {UpsunActivity & {
 *   project: string
 *   environments: [string, ...string[]]
 * }} UpsunValidatedActivity
 */

/**
 * @typedef {Object} UpsunEnvironment
 * @property {string} id - Environment identifier
 * @property {string} name - The environment name
 * @property {string} machine_name - Machine-readable environment name
 * @property {string} type - The environment type (e.g., "production", "development")
 * @property {string} head_commit - The ID of the environment's latest Git commit
 * @property {boolean} is_main - Whether this is the main environment
 * @property {boolean} is_pr - Whether this is a PR environment
 * @property {string} status - Whether the environment is active or not
 */

/**
 * @typedef {Object} UpsunCommit
 * @property {string} sha - Commit SHA
 * @property {Object} author - Commit author information
 * @property {string} author.email - Author email
 * @property {string} author.name - Author name
 * @property {number} author.date - Unix timestamp of commit
 * @property {string[]} parents - Parent commit SHAs
 * @property {string} message - Commit message
 */

/**
 * @typedef {Object} UpsunRoute
 * @property {string} id - Route ID
 * @property {boolean} primary - Whether this is the primary route
 * @property {string} type - Route type ("upstream" | "redirect")
 */

/**
 * @typedef {Object} UpsunDeployment
 * @property {string} id - Deployment ID
 * @property {Object.<string, UpsunRoute>} routes - All the URLs connected to the environment (includes redirects; filter by type="upstream" to exclude redirects)
 */

/**
 * @typedef {Object} UpsunActivityPayload
 * @property {Object} user - User who triggered the activity
 * @property {string} user.id - User ID
 * @property {string} user.display_name - User's display name
 * @property {UpsunEnvironment} environment - Environment configuration
 * @property {Array<UpsunCommit>} [commits] - Git commits in the push
 * @property {number} [commits_count] - Number of commits
 * @property {UpsunDeployment} [deployment] - Deployment configuration
 */

/**
 * @typedef {Object} UpsunActivityParameters
 * @property {string} [user] - User ID who triggered the activity
 * @property {string} [environment] - Environment name
 * @property {string} [old_commit] - Previous Git commit hash
 * @property {string} [new_commit] - New Git commit hash
 */

/**
 * @typedef {Object.<string, string>} UpsunVariables
 */

/**
 * @typedef { UpsunVariables & {
 *   GH_TOKEN: string,
 *   GH_REPO: string
 * }} UpsunValidatedVariables
 */

/**
 * @typedef {Object} UpsunProject
 * @property {Object} subscription - The subscription for the project
 * @property {string} [subscription.subscription_management_uri] - Url to the the management of the subscription
 */

/**
 * @typedef {Object} UpsunStorage
 * @see https://docs.upsun.com/integrations/activity.html#storage-api
 * @property {(key: string) => string | null | undefined} get
 * @property {(key: string, value: string) => void} set
 * @property {(key: string) => void} remove
 * @property {() => void} clear
 */

/**
 * GitHub Deployment object from the Deployments API
 * @see https://docs.github.com/en/rest/deployments/deployments
 * @typedef {Object} GitHubDeployment
 * @property {string} url - Full URL of the deployment
 * @property {number} id - Unique identifier of the deployment
 * @property {string} node_id - Node identifier
 * @property {string} sha - Commit SHA being deployed
 * @property {string} ref - Reference (branch, tag, or SHA) to deploy
 * @property {string} task - Deployment task (e.g., "deploy")
 * @property {Object|string} payload - Extra deployment information
 * @property {string} [original_environment] - Original deployment environment
 * @property {string} environment - Target deployment environment
 * @property {string|null} description - Short description of the deployment
 * @property {Object} creator - User who created the deployment
 * @property {string} created_at - Timestamp of deployment creation (ISO 8601)
 * @property {string} updated_at - Timestamp of last deployment update (ISO 8601)
 * @property {string} statuses_url - URL for deployment statuses
 * @property {string} repository_url - URL of the repository
 * @property {boolean} transient_environment - Whether the environment is temporary
 * @property {boolean} production_environment - Whether it's a production environment
 * @property {Object|null} [performed_via_github_app] - GitHub App details (optional)
 */

/**
 * @typedef {Object} GitHubDeploymentStatus
 * @property {string} state - Status state: "queued" | "in_progress" | "success" | "failure" | "inactive"
 * @property {string} [description] - Status description
 * @property {string} [log_url] - URL to deployment logs
 * @property {string} [environment_url] - URL to deployed environment
 * @property {boolean} [auto_inactive] - Mark previous deployments as inactive
 */

/**
 * GitHub Deployments API response - array of deployments
 * @typedef {Array<GitHubDeployment>} GitHubDeploymentsResponse
 */

/**
 * @typedef {Object} GitHubBranch
 * @property {string} name - Branch name
 * @property {{ sha: string, url: string }} commit - Head commit details
 * @property {boolean} protected - Whether branch protections are enabled
 */

/**
 * GitHub API response for branches where a commit is HEAD.
 * @typedef {Array<GitHubBranch>} GitHubBranchesWhereHeadResponse
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
 * Handle environment deployment (push/activate)
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

  console.log(
    `Falling back to environment name ${activity.environments[0]} as deployment ref`,
  );
  return activity.environments[0];
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
