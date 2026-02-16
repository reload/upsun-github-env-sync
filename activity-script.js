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
 */

// Global variables provided by Upsun:
// - activity: Object with id, type, state, result, payload, etc.
// - project: Object with project information

/**
 * Main entry point for the activity script
 */
(function() {
  'use strict';

  // Configuration
  const GITHUB_API_VERSION = '2022-11-28';
  const GITHUB_API_BASE = 'https://api.github.com';

  // Check if we should process this activity
  if (!shouldProcessActivity()) {
    console.log(`Skipping activity type: ${activity.type}, state: ${activity.state}`);
    return;
  }

  // Get required configuration
  const config = getConfiguration();
  if (!config.valid) {
    console.error('Configuration error:', config.error);
    return;
  }

  console.log(`Processing activity: ${activity.type} (${activity.state}) for environment: ${config.environment}`);

  // Process the activity
  processActivity(config);
})();

/**
 * Determine if this activity should be processed
 */
function shouldProcessActivity() {
  const supportedTypes = [
    'environment.push',
    'environment.activate',
    'environment.deactivate',
    'environment.delete'
  ];

  return supportedTypes.includes(activity.type);
}

/**
 * Get configuration from environment and activity context
 */
function getConfiguration() {
  const ghToken = activity.variables.GH_TOKEN || '';
  const ghRepo = activity.variables.GH_REPO || '';
  const projectId = activity.project || '';
  const environment = activity.environments[0] || '';

  // Validate required configuration
  if (!ghToken) {
    return { valid: false, error: 'GH_TOKEN variable not set' };
  }

  if (!projectId) {
    return { valid: false, error: 'Project ID not available' };
  }

  if (!environment) {
    return { valid: false, error: 'Environment not available' };
  }

  return {
    valid: true,
    ghToken,
    ghRepo,
    projectId,
    environment,
    activityId: activity.id,
    activityType: activity.type,
    activityState: activity.state,
    activityResult: activity.result
  };
}

/**
 * Process the activity and update GitHub deployment status
 */
function processActivity(config) {
  try {
    // Determine what action to take based on activity type and state
    if (config.activityType === 'environment.deactivate' || config.activityType === 'environment.delete') {
      handleEnvironmentDeactivation(config);
    } else {
      handleEnvironmentDeployment(config);
    }
  } catch (error) {
    console.error('Error processing activity:', error.message);
  }
}

/**
 * Handle environment deactivation/deletion
 */
function handleEnvironmentDeactivation(config) {
  console.log(`Marking deployment as inactive for environment: ${config.environment}`);

  // Get the latest deployment for this environment
  const deployment = getLatestDeployment(config);

  if (!deployment) {
    console.log('No deployment found to deactivate');
    return;
  }

  // Mark deployment as inactive
  createDeploymentStatus(config, deployment.id, {
    state: 'inactive',
    description: 'Environment closed'
  });

  console.log(`Deployment ${deployment.id} marked as inactive`);
}

/**
 * Handle environment deployment (push/activate)
 */
function handleEnvironmentDeployment(config) {
  // Get or create deployment
  let deployment = getLatestDeployment(config);

  // If no deployment exists, create one
  if (!deployment) {
    console.log('No deployment found, creating new deployment');
    deployment = createDeployment(config);

    if (!deployment) {
      console.error('Failed to create deployment');
      return;
    }
  }

  // Determine deployment status based on activity state
  const status = getDeploymentStatus(config);

  console.log(`Updating deployment ${deployment.id} status to: ${status.state}`);

  // Update deployment status
  createDeploymentStatus(config, deployment.id, status);
}

/**
 * Get the latest deployment for an environment
 */
function getLatestDeployment(config) {
  const repo = config.ghRepo || getRepoFromGit(config);
    const url = `${GITHUB_API_BASE}/repos/${repo}/deployments?environment=${config.environment}&per_page=1`;

  try {
    const response = fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${config.ghToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch deployment: ${response.status} ${response.statusText}`);
      return null;
    }

    const deployments = JSON.parse(response.body);

    if (deployments.length === 0) {
      return null;
    }

    return deployments[0];
  } catch (error) {
    console.error('Error fetching deployment:', error.message);
    return null;
  }
}

/**
 * Create a new GitHub deployment
 */
function createDeployment(config) {
  const repo = config.ghRepo || getRepoFromGit(config);
  const url = `${GITHUB_API_BASE}/repos/${repo}/deployments`;

  // Determine environment flags
  const isProduction = config.environment === 'main' || config.environment === 'production';
  const isTransient = config.environment.startsWith('pr-') || config.environment.startsWith('preview-');

  // Get the commit SHA from activity payload
  const ref = getCommitRef(config);

  const payload = {
    ref: ref,
    environment: config.environment,
    production_environment: isProduction,
    transient_environment: isTransient,
    auto_merge: false,
    required_contexts: [] // Bypass status checks
  };

  try {
    const response = fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${config.ghToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Failed to create deployment: ${response.status} ${response.statusText}`);
      console.error('Response:', response.body);
      return null;
    }

    const deployment = JSON.parse(response.body);
    console.log(`Created deployment ${deployment.id} for environment: ${config.environment}`);

    return deployment;
  } catch (error) {
    console.error('Error creating deployment:', error.message);
    return null;
  }
}

/**
 * Create a deployment status
 */
function createDeploymentStatus(config, deploymentId, status) {
  const repo = config.ghRepo || getRepoFromGit(config);
  const url = `${GITHUB_API_BASE}/repos/${repo}/deployments/${deploymentId}/statuses`;

  try {
    const response = fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${config.ghToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(status)
    });

    if (!response.ok) {
      console.error(`Failed to create deployment status: ${response.status} ${response.statusText}`);
      console.error('Response:', response.body);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error creating deployment status:', error.message);
    return false;
  }
}

/**
 * Determine deployment status based on activity state and result
 */
function getDeploymentStatus(config) {
  const logUrl = `https://console.upsun.com/reload-frf/${config.projectId}/-/log/${config.activityId}`;

  // Activity is pending/starting
  if (config.activityState === 'pending') {
    return {
      state: 'queued',
      description: 'Deployment queued'
    };
  }

  // Activity is in progress
  if (config.activityState === 'in_progress') {
    return {
      state: 'in_progress',
      description: 'Deployment in progress',
      log_url: logUrl
    };
  }

  // Activity is complete
  if (config.activityState === 'complete') {
    if (config.activityResult === 'success') {
      const environmentUrl = getEnvironmentUrl(config);
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
 * Get the environment URL from Platform.sh routes
 */
function getEnvironmentUrl(config) {
  try {
    // Try to get from PLATFORM_ROUTES environment variable
    const routesEnv = activity.variables.PLATFORM_ROUTES;
    if (routesEnv) {
      // Routes are base64 encoded JSON
      const routesJson = atob(routesEnv);
      const routes = JSON.parse(routesJson);

      // Find the primary route
      for (const [url, route] of Object.entries(routes)) {
        if (route.primary === true) {
          return url;
        }
      }

      // If no primary route, return first route
      const firstUrl = Object.keys(routes)[0];
      if (firstUrl) {
        return firstUrl;
      }
    }
  } catch (error) {
    console.error('Error parsing PLATFORM_ROUTES:', error.message);
  }

  // Fallback: construct URL from environment name
  // This is project-specific and may need adjustment
  if (config.environment === 'main') {
    return 'https://www.bupl.dk';
  }

  return `https://${config.environment}.webtestbupl.dk`;
}

/**
 * Get commit reference from activity payload
 */
function getCommitRef(config) {
  try {
    // Try to get from payload
    if (activity.payload && activity.payload.commits && activity.payload.commits.length > 0) {
      // Get the latest commit
      const commits = activity.payload.commits;
      return commits[commits.length - 1].sha || commits[commits.length - 1];
    }

    // Try to get from parameters
    if (activity.parameters && activity.parameters.new_commit) {
      return activity.parameters.new_commit;
    }
  } catch (error) {
    console.error('Error getting commit ref:', error.message);
  }

  // Fallback: use environment name as ref
  return config.environment;
}

/**
 * Auto-detect GitHub repository from git remote (fallback)
 */
function getRepoFromGit(config) {
  // This would require shell access which isn't available in activity scripts
  // So we return a default or throw an error
  console.error('GH_REPO not configured and cannot auto-detect in activity script context');
  throw new Error('GH_REPO variable must be set');
}

/**
 * Polyfill for atob if not available
 */
if (typeof atob === 'undefined') {
  function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
  }
}
