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
 * - GH_REPO: GitHub repository in format "owner/repo" (optional, auto-detected from git)
 *
 * @file
 */

// ============================================================================
// TypeScript Type Definitions (for validation and IDE support)
// ============================================================================

/**
 * @typedef {Object} UpsunActivity
 * @property {string} id - Unique identifier for the activity
 * @property {string} type - Activity type (e.g., "environment.push")
 * @property {string} state - Activity state: "pending" | "in_progress" | "complete"
 * @property {string} [result] - Activity result: "success" | "failure" (only when state is "complete")
 * @property {string} project - Project ID
 * @property {string[]} environments - Array of environment names affected by this activity
 * @property {string} [variables.PLATFORM_ROUTES] - Base64 encoded JSON of platform routes
 * @property {UpsunActivityPayload} [payload] - Detailed activity information
 * @property {UpsunActivityParameters} [parameters] - Activity parameters
 */

/**
 * Upsun environment object from activity payload
 * @typedef {Object} UpsunEnvironment
 * @property {string} id - Environment identifier
 * @property {string} name - The environment name
 * @property {string} machine_name - Machine-readable environment name
 * @property {string} type - The environment type (e.g., "production", "development")
 * @property {string} head_commit - The ID of the environment's latest Git commit
 * @property {string} edge_hostname - The URL you should target when setting up a custom domain
 * @property {boolean} is_main - Whether this is the main environment
 * @property {boolean} is_pr - Whether this is a PR environment
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
 * @property {string} [id] - Route ID
 * @property {boolean} primary - Whether this is the primary route
 * @property {string} type - Route type ("upstream" | "redirect")
 * @property {string} [production_url] - Production URL
 */

/**
 * @typedef {Object} UpsunVariable
 * @property {string} name - Variable name
 * @property {string} [value] - Value (if not sensitive)
 */

/**
 * @typedef {Object} UpsunDeployment
 * @property {string} id - Deployment ID
 * @property {Object.<string, UpsunRoute>} routes - All the URLs connected to the environment (includes redirects; filter by type="upstream" to exclude redirects)
 * @property {UpsunVariable[]} [variables] - All the variables for the environment
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

// ============================================================================
// Configuration Constants
// ============================================================================

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_API_BASE = 'https://api.github.com';

// ============================================================================
// Function Declarations
// ============================================================================

/**
 * Determine if this activity should be processed
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {boolean}
 */
function shouldProcessActivity(activity) {
  const supportedTypes = [
    'environment.push',
    'environment.activate',
    'environment.deactivate',
    'environment.delete'
  ];

  return supportedTypes.includes(activity.type);
}

/**
 * Parse GitHub configuration from the current activity.
 *
 * @param {UpsunActivity} activity
 * @return {{GH_REPO: string?, GH_TOKEN: string?}}
 */
function githubConfig(activity) {
  return {
    GH_REPO: activity.payload?.deployment?.variables.find(v => v.name === 'GH_REPO')?.value,
    GH_TOKEN: activity.payload?.deployment?.variables.find(v => v.name === 'GH_TOKEN')?.value
  };
}

/**
 * Validate required configuration from activity
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {{valid: boolean, error?: string}}
 */
function validateConfiguration(activity) {
  if (!githubConfig(activity).GH_TOKEN) {
    return { valid: false, error: 'GH_TOKEN variable not set' };
  }

  if (!githubConfig(activity).GH_REPO) {
    return { valid: false, error: 'GH_REPO variable not set' };
  }

  if (!activity.project) {
    return { valid: false, error: 'Project ID not available' };
  }

  if (!activity.environments || activity.environments.length === 0) {
    return { valid: false, error: 'Environment not available' };
  }

  return { valid: true };
}

/**
 * Process the activity and update GitHub deployment status
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {void}
 */
function processActivity(activity) {
  try {
    // Determine what action to take based on activity type and state
    if (activity.type === 'environment.deactivate' || activity.type === 'environment.delete') {
      handleEnvironmentDeactivation(activity);
    } else {
      handleEnvironmentDeployment(activity);
    }
  } catch (error) {
    console.log('Error processing activity:', error.message);
  }
}

/**
 * Handle environment deactivation/deletion
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {void}
 */
function handleEnvironmentDeactivation(activity) {
  const environment = activity.environments[0];
  console.log(`Marking deployment as inactive for environment: ${environment}`);

  // Get the latest deployment for this environment
  const deployment = getLatestDeployment(activity);
  if (!deployment) {
    console.log('No deployment found to deactivate');
    return;
  }

  // Mark deployment as inactive
  createDeploymentStatus(activity, deployment.id, {
    state: 'inactive',
    description: 'Environment closed'
  });

  console.log(`Deployment ${deployment.id} marked as inactive`);
}

/**
 * Handle environment deployment (push/activate)
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {void}
 */
function handleEnvironmentDeployment(activity) {
  // Get or create deployment
  let deployment = getLatestDeployment(activity);

  // If no deployment exists, create one
  if (!deployment) {
    console.log('No deployment found, creating new deployment');
    deployment = createDeployment(activity);

    if (!deployment) {
      console.log('Failed to create deployment');
      return;
    }
  }

  // Determine deployment status based on activity state
  const status = getDeploymentStatus(activity);

  console.log(`Updating deployment ${deployment.id} status to: ${status.state}`);

  // Update deployment status
  createDeploymentStatus(activity, deployment.id, status);
}

/**
 * Get the latest deployment for an environment
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {GitHubDeployment|null}
 */
function getLatestDeployment(activity) {
  const repo = githubConfig(activity).GH_REPO;
  const environment = activity.environments[0];
  const url = `${GITHUB_API_BASE}/repos/${repo}/deployments?environment=${environment}&per_page=1`;

  try {
    /** @type Response|any */
    const response = fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${githubConfig(activity).GH_TOKEN}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION
      }
    });
    if (!response.ok) {
      console.log(`Failed to fetch deployment: ${response.status} ${response.statusText}`);
      return null;
    }

    /** @type {GitHubDeploymentsResponse} */
    const deployments = response.json();

    if (deployments.length === 0) {
      return null;
    }

    return deployments[0];
  } catch (error) {
    console.log('Error fetching deployment:', error.message);
    return null;
  }
}

/**
 * Create a new GitHub deployment
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {GitHubDeployment|null}
 */
function createDeployment(activity) {
  const github = githubConfig(activity);
  const repo = github.GH_REPO;
  const environment = activity.environments[0];
  const url = `${GITHUB_API_BASE}/repos/${repo}/deployments`;

  // Determine environment flags from Upsun environment type
  const upsunEnvType = activity.payload?.environment?.type || '';
  const isProduction = upsunEnvType === 'production';
  const isTransient = upsunEnvType === 'development';

  // Get the commit SHA from activity payload
  const ref = getCommitRef(activity);

  const payload = {
    ref: ref,
    environment: environment,
    production_environment: isProduction,
    transient_environment: isTransient,
    auto_merge: false,
    required_contexts: [] // Bypass status checks
  };

  try {
    /** @type Response|any */
    const response = fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${github.GH_TOKEN}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = response.text();
      console.log(`Failed to create deployment: ${response.status} ${response.statusText}`);
      console.log('Response:', errorText);
      return null;
    }

    /** @type {GitHubDeployment} */
    const deployment = response.json();
    console.log(`Created deployment ${deployment.id} for environment: ${environment}`);

    return deployment;
  } catch (error) {
    console.log('Error creating deployment:', error.message);
    return null;
  }
}

/**
 * Create a deployment status
 * @param {UpsunActivity} activity - Upsun activity object
 * @param {number} deploymentId - GitHub deployment ID
 * @param {GitHubDeploymentStatus} status - Deployment status to create
 * @returns {boolean}
 */
function createDeploymentStatus(activity, deploymentId, status) {
  const github = githubConfig(activity);
  const repo = github.GH_REPO;
  const url = `${GITHUB_API_BASE}/repos/${repo}/deployments/${deploymentId}/statuses`;

  try {
    /** @type Response|any */
    const response = fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${github.GH_TOKEN}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(status)
    });

    if (!response.ok) {
      const errorText = response.text();
      console.log(`Failed to create deployment status: ${response.status} ${response.statusText}`);
      console.log('Response:', errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.log('Error creating deployment status:', error.message);
    return false;
  }
}

/**
 * Determine deployment status based on activity state and result
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {GitHubDeploymentStatus}
 */
function getDeploymentStatus(activity) {
  const logUrl = `https://console.upsun.com/reload-frf/${activity.project}/-/log/${activity.id}`;

  // Activity is pending/starting
  if (activity.state === 'pending') {
    return {
      state: 'queued',
      description: 'Deployment queued'
    };
  }

  // Activity is in progress
  if (activity.state === 'in_progress') {
    return {
      state: 'in_progress',
      description: 'Deployment in progress',
      log_url: logUrl
    };
  }

  // Activity is complete
  if (activity.state === 'complete') {
    if (activity.result === 'success') {
      const environmentUrl = getEnvironmentUrl(activity);
      return {
        state: 'success',
        description: 'Deployment successful',
        environment_url: environmentUrl,
        log_url: logUrl,
        auto_inactive: true // Mark previous deployments as inactive
      };
    } else {
      return {
        state: 'failure',
        description: 'Deployment failed',
        log_url: logUrl
      };
    }
  }

  // Default: queued
  return {
    state: 'queued',
    description: 'Deployment queued'
  };
}

/**
 * Returns the primary route from the deployment configuration.
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {{route: UpsunRoute, url: string}|{}}
 */
function getPrimaryRoute(activity) {
  return Object.entries(activity.payload.deployment.routes).reduce(
    (primary, [url, route]) =>
      route.primary ? { route, url } : primary,
    {}
  );
}

/**
 * Get the environment URL from Upsun routes
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {string}
 */
function getEnvironmentUrl(activity) {
  const environment = activity.environments[0];

  try {
    // Try to get primary route from deployment payload
    if (activity.payload?.deployment?.routes) {
      const primaryRoute = getPrimaryRoute(activity);
      if (primaryRoute && 'route' in primaryRoute) {
        // Prefer production_url, fallback to the URL key from routes object
        return primaryRoute.route.production_url || primaryRoute.url;
      }
    }
  } catch (error) {
    console.log('Error getting primary route:', error.message);
  }
}

/**
 * Get commit reference from activity payload
 * @param {UpsunActivity} activity - Upsun activity object
 * @returns {string}
 */
function getCommitRef(activity) {
  try {
    // Try to get from payload
    if (activity.payload && activity.payload.commits && activity.payload.commits.length > 0) {
      // Get the latest commit
      const commits = activity.payload.commits;
      const lastCommit = commits[commits.length - 1];
      // Handle both string and object formats
      if (typeof lastCommit === 'string') {
        return lastCommit;
      } else if (lastCommit && lastCommit.sha) {
        return lastCommit.sha;
      }
    }

    // Try to get from parameters
    if (activity.parameters && activity.parameters.new_commit) {
      return activity.parameters.new_commit;
    }
  } catch (error) {
    console.log('Error getting commit ref:', error.message);
  }

  // Fallback: use environment name as ref
  return activity.environments[0];
}


// ============================================================================
// Main Execution
// ============================================================================

/**
 * @param {UpsunActivity} activity
 * @returns {void}
 */
function main(activity) {
  'use strict';

  // Check if we should process this activity
  if (!shouldProcessActivity(activity)) {
    console.log(`Skipping activity type: ${activity.type}, state: ${activity.state}`);
    return;
  }

  // Validate required configuration
  const validation = validateConfiguration(activity);
  if (!validation.valid) {
    console.log('Configuration error:', validation.error);
    return;
  }

  const environment = activity.environments[0];
  console.log(`Processing activity: ${activity.type} (${activity.state}) for environment: ${environment}`);

  // Process the activity
  processActivity(activity);
}

// @ts-ignore
main(activity);
