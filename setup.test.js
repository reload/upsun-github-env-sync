// @ts-check
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  VERSION_VARIABLE,
  findManagedIntegration,
  upsertVariable,
  sync,
} = require("./setup.js");

/**
 * Fixtures in, calls out. Writes are recorded, never applied: no test reads
 * back what it wrote earlier in the same run.
 *
 * @param {Array<{ id: string, type: string, variables?: Array<{ id: string, name: string, value?: string }> }>} integrations
 */
function createFakeClient(integrations) {
  /** @type {unknown[][]} */
  const calls = [];
  /** @param {string} name */
  const record =
    (name) =>
    /** @param {unknown[]} args */
    (...args) => {
      calls.push([name, ...args]);
    };

  return {
    calls,
    listIntegrations: () => integrations,
    /** @param {string} integrationId */
    listVariables: (integrationId) =>
      integrations.find((integration) => integration.id === integrationId)
        ?.variables ?? [],
    createIntegration: () => {
      calls.push(["createIntegration"]);
      return "new";
    },
    updateIntegration: record("updateIntegration"),
    createVariable: record("createVariable"),
    patchVariable: record("patchVariable"),
  };
}

const marker = { id: "var-1", name: VERSION_VARIABLE, value: "0.1.0" };

describe("findManagedIntegration", () => {
  it("returns null when no script integration carries the version variable", () => {
    const client = createFakeClient([
      { id: "slack", type: "script", variables: [{ id: "v", name: "HOOK" }] },
      { id: "gh", type: "github", variables: [marker] },
    ]);

    assert.equal(findManagedIntegration(client), null);
  });

  it("returns the single marked script integration", () => {
    const client = createFakeClient([
      { id: "slack", type: "script" },
      { id: "ours", type: "script", variables: [marker] },
    ]);

    assert.equal(findManagedIntegration(client), "ours");
  });

  it("fails when more than one script integration is marked", () => {
    const client = createFakeClient([
      { id: "a", type: "script", variables: [marker] },
      { id: "b", type: "script", variables: [marker] },
    ]);

    assert.throws(() => findManagedIntegration(client), /Found 2 script/);
  });
});

describe("upsertVariable", () => {
  it("patches an existing variable by ID", () => {
    const client = createFakeClient([
      { id: "ours", type: "script", variables: [marker] },
    ]);

    upsertVariable(client, "ours", {
      name: VERSION_VARIABLE,
      value: "0.2.0",
      is_sensitive: false,
    });

    assert.deepEqual(client.calls, [
      [
        "patchVariable",
        "ours",
        "var-1",
        { value: "0.2.0", is_sensitive: false },
      ],
    ]);
  });

  it("creates a missing variable", () => {
    const client = createFakeClient([{ id: "ours", type: "script" }]);

    upsertVariable(client, "ours", { name: "GH_REPO", value: "org/repo" });

    assert.deepEqual(client.calls, [
      ["createVariable", "ours", { name: "GH_REPO", value: "org/repo" }],
    ]);
  });
});

describe("sync", () => {
  const options = {
    version: "0.3.0",
    githubRepository: "reload/site",
    githubDeployToken: "ghp_secret",
  };
  const version = {
    name: VERSION_VARIABLE,
    value: "0.3.0",
    is_sensitive: false,
  };
  const token = { name: "GH_TOKEN", value: "ghp_secret", is_sensitive: true };
  const repo = { name: "GH_REPO", value: "reload/site", is_sensitive: false };

  it("creates and marks an integration when none is ours", () => {
    const client = createFakeClient([{ id: "slack", type: "script" }]);

    const integrationId = sync({ client, ...options });

    assert.equal(integrationId, "new");
    assert.deepEqual(client.calls, [
      ["createIntegration"],
      ["createVariable", "new", version],
      ["createVariable", "new", token],
      ["createVariable", "new", repo],
    ]);
  });

  it("updates ours in place and leaves other integrations alone", () => {
    const client = createFakeClient([
      { id: "slack", type: "script" },
      {
        id: "ours",
        type: "script",
        variables: [marker, { id: "var-2", name: "GH_REPO", value: "old" }],
      },
    ]);

    const integrationId = sync({ client, ...options });

    assert.equal(integrationId, "ours");
    assert.deepEqual(client.calls, [
      ["updateIntegration", "ours"],
      ["createVariable", "ours", token],
      [
        "patchVariable",
        "ours",
        "var-2",
        { value: "reload/site", is_sensitive: false },
      ],
      [
        "patchVariable",
        "ours",
        "var-1",
        { value: "0.3.0", is_sensitive: false },
      ],
    ]);
  });
});
