#!/usr/bin/env node
// @ts-check
"use strict";

const { execFileSync } = require("node:child_process");
const { appendFileSync, readFileSync } = require("node:fs");
const path = require("node:path");

/** Presence marks an integration as ours; value records the installed release. */
const VERSION_VARIABLE = "UPSUN_GITHUB_ENV_SYNC_VERSION";

const EVENTS = [
  "environment.push",
  "environment.activate",
  "environment.redeploy",
  "environment.domain.create",
  "environment.domain.delete",
  "environment.deactivate",
  "environment.delete",
];

/**
 * @typedef {{ id: string, type: string }} Integration
 * @typedef {{ id: string, name: string, value?: string, is_sensitive?: boolean }} Variable
 *
 * @typedef {object} Client
 * @property {() => Integration[]} listIntegrations
 * @property {(integrationId: string) => Variable[]} listVariables
 * @property {() => string} createIntegration Returns the new integration ID.
 * @property {(integrationId: string) => void} updateIntegration
 * @property {(integrationId: string, variable: Omit<Variable, "id">) => void} createVariable
 * @property {(integrationId: string, variableId: string, variable: Omit<Variable, "id" | "name">) => void} patchVariable
 */

/**
 * Only integrations carrying the version variable are ours. Others are never touched.
 *
 * @param {Client} client
 * @returns {string | null}
 */
function findManagedIntegration(client) {
  const managed = client
    .listIntegrations()
    .filter((integration) => integration.type === "script")
    .map((integration) => String(integration.id))
    .filter((integrationId) =>
      client
        .listVariables(integrationId)
        .some((variable) => variable.name === VERSION_VARIABLE),
    );

  if (managed.length > 1) {
    throw new Error(
      `Found ${managed.length} script integrations with a ${VERSION_VARIABLE} variable. Delete all but one.`,
    );
  }

  return managed[0] ?? null;
}

/**
 * @param {Client} client
 * @param {string} integrationId
 * @param {Omit<Variable, "id">} variable
 */
function upsertVariable(client, integrationId, variable) {
  const existing = client
    .listVariables(integrationId)
    .find((candidate) => candidate.name === variable.name);

  if (existing) {
    client.patchVariable(integrationId, existing.id, {
      value: variable.value,
      is_sensitive: variable.is_sensitive,
    });
  } else {
    client.createVariable(integrationId, variable);
  }
}

/**
 * @param {object} options
 * @param {Client} options.client
 * @param {string} options.version
 * @param {string} options.githubRepository
 * @param {string} options.githubDeployToken
 * @param {(message: string) => void} [options.log]
 * @returns {string}
 */
function sync({
  client,
  version,
  githubRepository,
  githubDeployToken,
  log = () => {},
}) {
  const versionVariable = {
    name: VERSION_VARIABLE,
    value: version,
    is_sensitive: false,
  };

  const existingId = findManagedIntegration(client);
  let integrationId = existingId;

  if (integrationId) {
    log(`Updating script integration ${integrationId}`);
    client.updateIntegration(integrationId);
  } else {
    log("Creating script integration");
    integrationId = client.createIntegration();
    // Mark first so a failure below leaves an integration the next run recognizes.
    upsertVariable(client, integrationId, versionVariable);
  }

  upsertVariable(client, integrationId, {
    name: "GH_TOKEN",
    value: githubDeployToken,
    is_sensitive: true,
  });
  upsertVariable(client, integrationId, {
    name: "GH_REPO",
    value: githubRepository,
    is_sensitive: false,
  });
  if (existingId) {
    // Record the version last so it only changes once the update completed.
    upsertVariable(client, integrationId, versionVariable);
  }

  return integrationId;
}

/**
 * Talks to the Upsun API through `upsun api:curl`, which handles authentication.
 *
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.scriptFile
 * @returns {Client}
 */
function createCliClient({ projectId, scriptFile }) {
  /**
   * @param {string} apiPath
   * @param {"GET" | "POST" | "PATCH"} method
   * @param {object} [payload]
   * @returns {any}
   */
  const api = (apiPath, method, payload) => {
    const args = ["api:curl", apiPath, "--request", method, "--yes"];
    if (payload) {
      args.push("--json", JSON.stringify(payload));
    }
    let output;
    try {
      output = execFileSync("upsun", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      });
    } catch (error) {
      // execFileSync's own message repeats the command line, payload and secrets included.
      const body = /** @type {{ stdout?: string }} */ (error).stdout?.trim();
      throw new Error(`${method} ${apiPath} failed${body ? `: ${body}` : ""}`);
    }
    return JSON.parse(output || "null");
  };

  const integrationsPath = `/api/projects/${projectId}/integrations`;
  const integrationFields = () => ({
    script: readFileSync(scriptFile, "utf8"),
    events: EVENTS,
    states: ["*"],
    environments: ["*"],
  });

  return {
    listIntegrations: () => api(integrationsPath, "GET") ?? [],
    listVariables: (integrationId) =>
      api(`${integrationsPath}/${integrationId}/variables`, "GET") ?? [],
    createIntegration: () => {
      const response = api(integrationsPath, "POST", {
        type: "script",
        ...integrationFields(),
      });
      const id = response?._embedded?.entity?.id;
      if (!id) {
        throw new Error(
          `Create response has no integration ID: ${JSON.stringify(response)}`,
        );
      }
      return String(id);
    },
    updateIntegration: (integrationId) => {
      api(`${integrationsPath}/${integrationId}`, "PATCH", integrationFields());
    },
    createVariable: (integrationId, variable) => {
      api(`${integrationsPath}/${integrationId}/variables`, "POST", variable);
    },
    patchVariable: (integrationId, variableId, variable) => {
      api(
        `${integrationsPath}/${integrationId}/variables/${variableId}`,
        "PATCH",
        variable,
      );
    },
  };
}

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function main() {
  const actionPath = requireEnv("ACTION_PATH");
  const githubOutput = requireEnv("GITHUB_OUTPUT");

  const integrationId = sync({
    client: createCliClient({
      projectId: requireEnv("UPSUN_PROJECT_ID"),
      scriptFile: path.join(actionPath, "activity-script.js"),
    }),
    version: require(path.resolve(actionPath, "package.json")).version,
    githubRepository: requireEnv("GITHUB_REPOSITORY"),
    githubDeployToken: requireEnv("GITHUB_DEPLOY_TOKEN"),
    log: console.log,
  });

  appendFileSync(githubOutput, `integration_id=${integrationId}\n`);
  console.log(`Synchronized integration ${integrationId}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  VERSION_VARIABLE,
  EVENTS,
  findManagedIntegration,
  upsertVariable,
  sync,
};
