import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const scriptPath =
  ".platform/activity-scripts/upsun-github-env-sync/activity-script.js";
const script = fs.readFileSync(scriptPath, "utf8");

function runScript({
  activity,
  variables = { GH_TOKEN: "fake-token", GH_REPO: "owner/repo" },
  project = {
    subscription: {
      subscription_management_uri:
        "https://accounts.upsun.com/my-org/subscriptions/abc",
    },
  },
  deploymentsResponse = [{ id: 12345 }],
}) {
  const calls = [];

  const fetch = (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });

    if (url.includes("/deployments?environment=")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => deploymentsResponse,
      };
    }

    if (url.endsWith("/deployments")) {
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        json: () => ({ id: 67890 }),
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
    console: {
      log: () => {},
    },
  });

  return calls;
}

test("environment.push complete success updates existing deployment", () => {
  const calls = runScript({
    activity: {
      id: "act-1",
      type: "environment.push",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["main"],
      payload: {
        environment: { status: "active", type: "production" },
        commits: [{ sha: "abc123" }],
        deployment: {
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
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/deployments\?environment=main&per_page=1$/);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].body.state, "success");
  assert.equal(calls[1].body.environment_url, "https://main.example.com/");
  assert.equal(calls[1].body.auto_inactive, true);
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
        environment: { status: "active", type: "development" },
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].body.state, "inactive");
  assert.equal(calls[1].body.description, "Environment closed");
});

test("creates deployment when none exists", () => {
  const calls = runScript({
    deploymentsResponse: [],
    activity: {
      id: "act-3",
      type: "environment.activate",
      state: "complete",
      result: "success",
      project: "proj123",
      environments: ["dev"],
      payload: {
        environment: { status: "active", type: "development" },
      },
      parameters: { new_commit: "def456" },
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/deployments$/);
  assert.equal(calls[1].body.environment, "dev");
  assert.equal(calls[2].method, "POST");
  assert.match(calls[2].url, /\/deployments\/67890\/statuses$/);
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
        environment: { status: "active", type: "production" },
      },
    },
  });

  assert.equal(calls.length, 0);
});
