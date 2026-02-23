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
 * @returns {UpsunEnvironment}
 */
function createEnvironment(name, type) {
  return {
    id: `env-${name}`,
    name,
    machine_name: name,
    type,
    head_commit: "fixture-sha",
    is_main: name === "main",
    is_pr: false,
    status: "active",
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
 * @param {{
 *   activity: UpsunActivity,
 *   variables?: UpsunVariables,
 *   project?: UpsunProject,
 *   deployments?: GitHubDeployment[]
 *   createdDeployment?: GitHubDeployment
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
  deployments = [createGitHubDeployment(12345)],
  createdDeployment = createGitHubDeployment(67890),
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
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => deployments,
      };
    }

    if (url.endsWith("/deployments")) {
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        json: () => createdDeployment,
      };
    }

    if (/\/deployments\/\d+$/.test(url) && method === "GET") {
      const deploymentId = Number(url.match(/\/deployments\/(\d+)$/)?.[1]);
      const deployment = deployments.find(
        (candidate) => candidate.id === deploymentId,
      );
      if (!deployment) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => deployment,
      };
    }

    if (url.includes("/statuses")) {
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        json: () => ({ id: 999 }),
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

test("environment.push complete success updates existing deployment", () => {
  const storage = createStorage();
  const calls = runScript({
    storage,
    activity: {
      id: "act-1",
      type: "environment.push",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["main"],
      payload: {
        user: createUser(),
        environment: createEnvironment("main", "production"),
        commits: [createCommit("abc123")],
        deployment: {
          id: "deployment-1",
          routes: {
            "https://main.example.com/": {
              id: "route1",
              primary: true,
              type: "upstream",
            },
          },
        },
      },
      parameters: { new_commit: "abc123" },
    },
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0, "expected fetch call at index 0");
  assert.equal(call0.method, "POST");
  assert.match(call0.url, /\/deployments$/);
  assert.ok(call0.body, "expected fetch body at index 0");
  assert.equal(call0.body.environment, "main");
  const call1 = calls[1];
  assert.ok(call1, "expected fetch call at index 1");
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/67890\/statuses$/);
  assert.ok(call1.body, "expected fetch body at index 1");
  assert.equal(call1.body.state, "success");
  assert.equal(call1.body.environment_url, "https://main.example.com/");
  assert.equal(call1.body.auto_inactive, true);
  assert.equal(
    storage.get("upsun-github-deployment-by-activity:act-1"),
    "67890",
  );
});

test("environment.deactivate complete marks deployment inactive", () => {
  const calls = runScript({
    activity: {
      id: "act-2",
      type: "environment.deactivate",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["feature-1"],
      payload: {
        user: createUser(),
        environment: createEnvironment("feature-1", "development"),
      },
    },
  });

  assert.equal(calls.length, 2);
  const call1 = calls[1];
  assert.ok(call1, "expected fetch call at index 1");
  assert.equal(call1.method, "POST");
  assert.ok(call1.body, "expected fetch body at index 1");
  assert.equal(call1.body.state, "inactive");
  assert.equal(call1.body.description, "Environment closed");
});

test("environment.activate uses latest deployment when available", () => {
  const calls = runScript({
    activity: {
      id: "act-3",
      type: "environment.activate",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["dev"],
      payload: {
        user: createUser(),
        environment: createEnvironment("dev", "development"),
      },
      parameters: { new_commit: "def456" },
    },
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0, "expected fetch call at index 0");
  assert.equal(call0.method, "GET");
  const call1 = calls[1];
  assert.ok(call1, "expected fetch call at index 1");
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/12345\/statuses$/);
});

test("environment.activate skips when no latest deployment exists", () => {
  const calls = runScript({
    deployments: [],
    activity: {
      id: "act-3b",
      type: "environment.activate",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["dev"],
      payload: {
        user: createUser(),
        environment: createEnvironment("dev", "development"),
      },
      parameters: { new_commit: "def456" },
    },
  });

  assert.equal(calls.length, 1);
  const call0 = calls[0];
  assert.ok(call0, "expected fetch call at index 0");
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\?environment=dev&per_page=1$/);
});

test("environment.push reuses stored deployment id for same activity", () => {
  const storage = createStorage({
    "upsun-github-deployment-by-activity:act-5": "777",
  });

  const calls = runScript({
    storage,
    deployments: [createGitHubDeployment(777)],
    activity: {
      id: "act-5",
      type: "environment.push",
      state: "in_progress",
      project: "proj123",
      environments: ["main"],
      payload: {
        user: createUser(),
        environment: createEnvironment("main", "production"),
      },
    },
  });

  assert.equal(calls.length, 2);
  const call0 = calls[0];
  assert.ok(call0, "expected fetch call at index 0");
  assert.equal(call0.method, "GET");
  assert.match(call0.url, /\/deployments\/777$/);
  const call1 = calls[1];
  assert.ok(call1, "expected fetch call at index 1");
  assert.equal(call1.method, "POST");
  assert.match(call1.url, /\/deployments\/777\/statuses$/);
  assert.ok(call1.body, "expected fetch body at index 1");
  assert.equal(call1.body.state, "in_progress");
});

test("environment.push throws when stored deployment id cannot be fetched", () => {
  const storage = createStorage({
    "upsun-github-deployment-by-activity:act-6": "888",
  });

  assert.throws(
    () =>
      runScript({
        storage,
        deployments: [],
        activity: {
          id: "act-6",
          type: "environment.push",
          state: "in_progress",
          project: "proj123",
          environments: ["main"],
          payload: {
            user: createUser(),
            environment: createEnvironment("main", "production"),
          },
        },
      }),
    /Failed to fetch deployment 888: 404 Not Found/,
  );
});

test("unsupported activity type is skipped", () => {
  const calls = runScript({
    activity: {
      id: "act-4",
      type: "backup.create",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["main"],
      payload: {
        user: createUser(),
        environment: createEnvironment("main", "production"),
      },
    },
  });

  assert.equal(calls.length, 0);
});
