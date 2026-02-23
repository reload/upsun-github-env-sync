// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * Reuse typedefs from the activity script to keep tests and runtime in sync.
 * @typedef {import("./activity-script.js").UpsunActivity} UpsunActivity
 * @typedef {import("./activity-script.js").UpsunVariables} UpsunVariables
 * @typedef {import("./activity-script.js").UpsunProject} UpsunProject
 * @typedef {import("./activity-script.js").UpsunEnvironment} UpsunEnvironment
 * @typedef {import("./activity-script.js").UpsunActivityPayload["user"]} UpsunUser
 * @typedef {import("./activity-script.js").UpsunCommit} UpsunCommit
 * @typedef {import("./activity-script.js").UpsunStorage} UpsunStorage
 * @typedef {import("./activity-script.js").GitHubDeployment} GitHubDeployment
 * @typedef {import("./activity-script.js").GitHubDeploymentStatus} GitHubDeploymentStatus
 */

/**
 * @typedef {Object} FetchCall
 * @property {string} url
 * @property {string} method
 * @property {Record<string, unknown> | undefined} body
 */

const scriptPath = path.join(__dirname, "activity-script.js");
const script = fs.readFileSync(scriptPath, "utf8");

/**
 * @param {string} name
 * @param {"production"|"development"} type
 * @param {"active"|"inactive"} [status]
 * @returns {UpsunEnvironment}
 */
function createEnvironment(name, type, status = "active") {
  return {
    id: `env-${name}`,
    name,
    machine_name: name,
    type,
    head_commit: "fixture-sha",
    is_main: name === "main",
    is_pr: false,
    status,
  };
}

/**
 * @returns {UpsunUser}
 */
function createUser() {
  return {
    id: "user-1",
    display_name: "Fixture User",
  };
}

/**
 * @param {string} sha
 * @returns {UpsunCommit}
 */
function createCommit(sha) {
  return {
    sha,
    author: {
      email: "fixture@example.com",
      name: "Fixture",
      date: 1735689600,
    },
    parents: [],
    message: "Fixture commit",
  };
}

/**
 * @param {number} id
 * @param {string} [environment]
 * @returns {GitHubDeployment}
 */
function createGitHubDeployment(id, environment = "main") {
  return {
    url: `https://api.github.com/repos/owner/repo/deployments/${id}`,
    id,
    node_id: `DEPLOYMENT_${id}`,
    sha: "fixture-sha",
    ref: "fixture-sha",
    task: "deploy",
    payload: {},
    environment,
    description: null,
    creator: { login: "fixture-user" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    statuses_url: `https://api.github.com/repos/owner/repo/deployments/${id}/statuses`,
    repository_url: "https://api.github.com/repos/owner/repo",
    transient_environment: false,
    production_environment: environment === "main",
  };
}

/**
 * @param {GitHubDeploymentStatus["state"]} [state]
 * @returns {GitHubDeploymentStatus}
 */
function createGitHubDeploymentStatus(state = "queued") {
  return {
    state,
    description: "Fixture deployment status",
  };
}

/**
 * @param {Record<string, string>} [initialValues]
 * @returns {UpsunStorage}
 */
function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
}

/**
 * @param {number} status
 * @returns {string}
 */
function getStatusText(status) {
  if (status === 200) {
    return "OK";
  }
  if (status === 201) {
    return "Created";
  }
  if (status === 404) {
    return "Not Found";
  }
  if (status === 500) {
    return "Internal Server Error";
  }
  return "Unknown";
}

/**
 * @param {{
 *   id: string,
 *   type: string,
 *   state: string,
 *   result?: string,
 *   environment?: string,
 *   environmentType?: "production"|"development",
 *   environmentStatus?: "active"|"inactive",
 *   includeDeploymentRoutes?: boolean,
 *   primaryRouteUrl?: string
 * }} options
 * @returns {UpsunActivity}
 */
function createActivity({
  id,
  type,
  state,
  result,
  environment = "main",
  environmentType = "production",
  environmentStatus = "active",
  primaryRouteUrl,
}) {
  /** @type {UpsunActivity} */
  const activity = {
    id,
    type,
    state,
    result,
    project: "proj123",
    environments: [environment],
    payload: {
      user: createUser(),
      environment: createEnvironment(
        environment,
        environmentType,
        environmentStatus,
      ),
      commits: [createCommit("abc123")],
    },
    parameters: { new_commit: "abc123" },
  };

  if (primaryRouteUrl && activity.payload) {
    const routeUrl = primaryRouteUrl || `https://${environment}.example.com/`;
    activity.payload.deployment = {
      id: `deployment-${id}`,
      routes: {
        [routeUrl]: {
          id: `route-${id}`,
          primary: true,
          type: "upstream",
        },
      },
    };
  }

  return activity;
}

/**
 * @param {{
 *   activity: UpsunActivity,
 *   variables?: UpsunVariables,
 *   project?: UpsunProject,
 *   latestDeploymentStatus?: number,
 *   deploymentByIdStatus?: number,
 *   deployments?: GitHubDeployment[],
 *   createDeploymentStatus?: number,
 *   createdDeployment?: GitHubDeployment,
 *   createStatusStatus?: number,
 *   createStatusResponse?: GitHubDeploymentStatus,
 *   storage?: UpsunStorage
 * }} params
 * @returns {FetchCall[]}
 */
function runScript({
  activity,
  variables = { GH_TOKEN: "fake-token", GH_REPO: "owner/repo" },
  project = {
    subscription: {
      subscription_management_uri:
        "https://accounts.upsun.com/my-org/subscriptions/abc",
    },
  },
  latestDeploymentStatus = 200,
  deploymentByIdStatus = 200,
  deployments = [createGitHubDeployment(12345, activity.environments[0])],
  createDeploymentStatus = 201,
  createdDeployment = createGitHubDeployment(67890, activity.environments[0]),
  createStatusStatus = 201,
  createStatusResponse = createGitHubDeploymentStatus(),
  storage = createStorage(),
}) {
  /** @type {FetchCall[]} */
  const calls = [];

  /**
   * @param {string} url
   * @param {{ method?: string, body?: string }} [options]
   * @returns {{ ok: boolean, status: number, statusText: string, json: () => unknown }}
   */
  const fetch = (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body
      ? /** @type {Record<string, unknown>} */ (JSON.parse(options.body))
      : undefined;
    calls.push({ url, method, body });

    if (url.includes("/deployments?environment=")) {
      const environment = new URL(url).searchParams.get("environment");
      const latest = deployments.filter((deployment) => {
        return deployment.environment === environment;
      });
      return {
        ok: latestDeploymentStatus >= 200 && latestDeploymentStatus < 300,
        status: latestDeploymentStatus,
        statusText: getStatusText(latestDeploymentStatus),
        json: () => latest,
      };
    }

    if (url.endsWith("/deployments") && method === "POST") {
      return {
        ok: createDeploymentStatus >= 200 && createDeploymentStatus < 300,
        status: createDeploymentStatus,
        statusText: getStatusText(createDeploymentStatus),
        json: () =>
          createDeploymentStatus >= 200 && createDeploymentStatus < 300
            ? createdDeployment
            : { message: "create deployment error" },
      };
    }

    if (/\/deployments\/\d+$/.test(url) && method === "GET") {
      const deploymentId = Number(url.match(/\/deployments\/(\d+)$/)?.[1]);
      const deployment = deployments.find((candidate) => {
        return candidate.id === deploymentId;
      });

      const status = deployment ? deploymentByIdStatus : 404;
      const ok = status >= 200 && status < 300;
      return {
        ok,
        status,
        statusText: getStatusText(status),
        json: () => (ok ? deployment : {}),
      };
    }

    if (url.includes("/statuses") && method === "POST") {
      return {
        ok: createStatusStatus >= 200 && createStatusStatus < 300,
        status: createStatusStatus,
        statusText: getStatusText(createStatusStatus),
        json: () =>
          createStatusStatus >= 200 && createStatusStatus < 300
            ? createStatusResponse
            : { message: "create status error" },
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => ({}),
    };
  };

  vm.runInNewContext(script, {
    activity,
    variables,
    project,
    fetch,
    require: (moduleName) => {
      if (moduleName === "storage") {
        return storage;
      }
      throw new Error(`Unsupported module: ${moduleName}`);
    },
    console: {
      log: () => {},
    },
  });

  return calls;
}

test("unsupported activity types are skipped", () => {
  const calls = runScript({
    activity: createActivity({
      id: "act-1",
      type: "backup.create",
      state: "complete",
      result: "success",
    }),
  });

  assert.equal(calls.length, 0);
});

test("inactive environments are skipped", () => {
  const calls = runScript({
    activity: createActivity({
      id: "act-2",
      type: "environment.push",
      state: "pending",
      environmentStatus: "inactive",
    }),
  });

  assert.equal(calls.length, 0);
});

test("environment.push (pending) creates a deployment when one is not mapped", () => {
  const storage = createStorage();
  const calls = runScript({
    storage,
    deployments: [],
    createdDeployment: createGitHubDeployment(7001, "main"),
    activity: createActivity({
      id: "act-3",
      type: "environment.push",
      state: "pending",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "POST");
  assert.match(call0.url, /\/deployments$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/7001\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "queued");

  assert.equal(
    storage.get("upsun-github-deployment-by-activity:act-3"),
    "7001",
  );
});

test("environment.push (in_progress) marks mapped deployment as in progress", () => {
  const storage = createStorage({
    "upsun-github-deployment-by-activity:act-4": "777",
  });
  const calls = runScript({
    storage,
    deployments: [createGitHubDeployment(777, "main")],
    activity: createActivity({
      id: "act-4",
      type: "environment.push",
      state: "in_progress",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\/777$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/777\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "in_progress");
});

test("environment.push (complete) marks mapped deployment as success", () => {
  const storage = createStorage({
    "upsun-github-deployment-by-activity:act-5": "778",
  });
  const calls = runScript({
    storage,
    deployments: [createGitHubDeployment(778, "main")],
    activity: createActivity({
      id: "act-5",
      type: "environment.push",
      state: "complete",
      result: "success",
    }),
  });

  assert.equal(calls.length, 2);
  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/778\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "success");
  assert.equal(call1.body.auto_inactive, true);
});

test("adding a domain on complete updates deployment with new domain", () => {
  const calls = runScript({
    deployments: [createGitHubDeployment(801, "main")],
    activity: createActivity({
      id: "act-6",
      type: "environment.domain.create",
      state: "complete",
      result: "success",
      primaryRouteUrl: "https://new-main.example.com/",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=main&per_page=1$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/801\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "success");
  assert.equal(call1.body.environment_url, "https://new-main.example.com/");
  assert.equal(call1.body.auto_inactive, true);
});

test("removing a domain on complete updates deployment with remaining domain", () => {
  const calls = runScript({
    deployments: [createGitHubDeployment(802, "main")],
    activity: createActivity({
      id: "act-7",
      type: "environment.domain.delete",
      state: "complete",
      result: "success",
      primaryRouteUrl: "https://main.example.com/",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=main&per_page=1$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/802\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "success");
  assert.equal(call1.body.environment_url, "https://main.example.com/");
  assert.equal(call1.body.auto_inactive, true);
});

test("environment.activate updates an existing deployment", () => {
  const calls = runScript({
    deployments: [createGitHubDeployment(803, "main")],
    activity: createActivity({
      id: "act-8",
      type: "environment.activate",
      state: "in_progress",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=main&per_page=1$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/803\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "in_progress");
});

test("environment.deactivate deactivates the latest deployment", () => {
  const calls = runScript({
    deployments: [createGitHubDeployment(901, "main")],
    activity: createActivity({
      id: "act-9",
      type: "environment.deactivate",
      state: "complete",
      result: "success",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=main&per_page=1$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/901\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "inactive");
  assert.equal(call1.body.description, "Environment closed");
});

test("environment.delete deactivates the latest deployment", () => {
  const calls = runScript({
    deployments: [createGitHubDeployment(902, "main")],
    activity: createActivity({
      id: "act-10",
      type: "environment.delete",
      state: "complete",
      result: "success",
    }),
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0);
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=main&per_page=1$/);

  const call1 = calls[1];
  assert.ok(call1);
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/902\/statuses$/);
  assert.ok(call1.body);
  assert.equal(call1.body.state, "inactive");
  assert.equal(call1.body.description, "Environment closed");
});

test("throws when mapped deployment id cannot be fetched", () => {
  const storage = createStorage({
    "upsun-github-deployment-by-activity:act-11": "999",
  });

  assert.throws(
    () =>
      runScript({
        storage,
        deployments: [],
        activity: createActivity({
          id: "act-11",
          type: "environment.push",
          state: "in_progress",
        }),
      }),
    /Failed to fetch deployment 999: 404 Not Found/,
  );
});

test("throws when latest deployment lookup fails", () => {
  assert.throws(
    () =>
      runScript({
        latestDeploymentStatus: 500,
        activity: createActivity({
          id: "act-12",
          type: "environment.activate",
          state: "in_progress",
        }),
      }),
    /Failed to fetch latest deployment for environment main: 500 Internal Server Error/,
  );
});

test("throws when creating a deployment fails", () => {
  assert.throws(
    () =>
      runScript({
        createDeploymentStatus: 500,
        deployments: [],
        activity: createActivity({
          id: "act-13",
          type: "environment.push",
          state: "pending",
        }),
      }),
    /Failed to create deployment: 500 Internal Server Error/,
  );
});

test("throws when creating deployment status fails", () => {
  assert.throws(
    () =>
      runScript({
        createStatusStatus: 500,
        deployments: [createGitHubDeployment(804, "main")],
        activity: createActivity({
          id: "act-14",
          type: "environment.activate",
          state: "in_progress",
        }),
      }),
    /Failed to create deployment status : 500 Internal Server Error/,
  );
});
