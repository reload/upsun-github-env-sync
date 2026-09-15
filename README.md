# Upsun GitHub Environment Sync

An Upsun activity script that syncs Upsun environments to GitHub deployments, and a GitHub Action that installs it in a project.

## Contents

- `activity-script.js`: The activity script. Upsun runs it on environment events.
- `action.yml` and `setup.js`: The composite GitHub Action that installs or updates the script in a project.
- `examples/upsun-github-env-sync.yml`: A workflow file for consumer repositories.

## How it works

Upsun runs the activity script on these events. The script maps each event and activity state to a GitHub deployment status:

| Upsun event                 | Activity state     | GitHub status | Details                         |
| --------------------------- | ------------------ | ------------- | ------------------------------- |
| `environment.push`          | pending            | queued        | New deployment for the activity |
| `environment.push`          | in_progress        | in_progress   | Links to the Upsun log          |
| `environment.push`          | complete (success) | success       | Links to the environment URL    |
| `environment.push`          | complete (failure) | failure       | Links to the Upsun log          |
| `environment.redeploy`      | pending            | queued        | Updates the latest deployment   |
| `environment.redeploy`      | in_progress        | in_progress   | Links to the Upsun log          |
| `environment.redeploy`      | complete (success) | success       | Links to the environment URL    |
| `environment.redeploy`      | complete (failure) | failure       | Links to the Upsun log          |
| `environment.activate`      | complete           | success       | Environment activated           |
| `environment.domain.create` | complete           | success       | Environment URL updated         |
| `environment.domain.delete` | complete           | success       | Environment URL updated         |
| `environment.deactivate`    | complete           | inactive      | Environment closed              |
| `environment.delete`        | complete           | inactive      | Environment deleted             |

A push creates one GitHub deployment per Upsun activity. All other events update the latest deployment of the environment.

The action connects to the Upsun project with the Upsun CLI. It creates a `script` integration with the events above, or updates the one it created before. Then it sets three variables on the integration:

- `GH_TOKEN` (sensitive): The GitHub token that the script uses.
- `GH_REPO`: The repository, taken from the workflow that runs the action.
- `UPSUN_GITHUB_ENV_SYNC_VERSION`: The installed release of this repository.

## Install the script in a project

Do these steps once for each consumer repository.

1. Create a fine-grained personal access token. Use a bot account if your organization has one, so the token does not stop when a person leaves. Give it access to the consumer repository only. Give it the longest lifetime that the organization policy permits. Give it these repository permissions:
   - `Metadata`: Read-only
   - `Contents`: Read-only
   - `Pull requests`: Read-only
   - `Deployments`: Read and write
   - `Environments`: Read and write
2. In the consumer repository, create the repository variable `UPSUN_PROJECT_ID` with the Upsun project ID.
3. In the consumer repository, create the repository secret `GH_DEPLOY_TOKEN` with the token from step 1.
4. Make sure that the repository can read a secret `UPSUN_API_TOKEN` that holds an Upsun API token with access to the project. Create the token in the Upsun Console, under the account settings of a user or a dedicated API user. See [Upsun API tokens](https://developer.upsun.com/cli/api-tokens) for the steps in the Console. A GitHub organization secret lets all consumer repositories share one token. If the secret is an organization secret, ask an organization owner to give the repository access.
5. Copy `examples/upsun-github-env-sync.yml` to `.github/workflows/` in the consumer repository. If the default branch is not `main`, change the branch name in the file.
6. Merge the workflow file. The push installs the script.
7. Open the workflow run. Make sure that the last step ends with `Synchronized integration` and an ID.

The workflow also runs every night at 04:00 UTC. This run installs new releases of the script.

### Inputs

| Input                 | Required | Description                                                                |
| --------------------- | -------- | -------------------------------------------------------------------------- |
| `upsun_project_id`    | Yes      | The Upsun project ID.                                                      |
| `upsun_api_token`     | Yes      | An Upsun API token with access to the project.                             |
| `github_deploy_token` | Yes      | The GitHub token that the script uses. See step 1 for permissions.         |
| `upsun_cli_version`   | No       | The Upsun CLI version to install, for example `5.11.0`. Default is latest. |

### Outputs

| Output           | Description                                        |
| ---------------- | -------------------------------------------------- |
| `integration_id` | The ID of the integration that the action manages. |

## Versions

Each release gets a tag, for example `v1.2.0`. The tag `v1` always points to the latest release in the `v1` line.

The example workflow uses `reload/upsun-github-env-sync@v1`. The nightly run then installs each new release without a change in the consumer repository. To stop on one release, use the exact tag instead:

```yaml
uses: reload/upsun-github-env-sync@v1.2.0
```

## Troubleshooting

### Using the Upsun CLI

The commands in this section use the Upsun CLI on your computer. To install it, run the installer from [upsun/cli](https://github.com/upsun/cli). Then run `upsun login`. To list the integrations of a project and their IDs:

```bash
upsun integrations --project PROJECT_ID
```

### Which integration the action manages

The action manages a script integration only if it has the variable `UPSUN_GITHUB_ENV_SYNC_VERSION`. The action creates this variable on the integration that it creates. The action does not read or change other integrations.

If the project has no integration with the variable, the action creates one. If the project has one, the action updates it. If the project has more than one, the action stops with `Found 2 script integrations`. Delete the extra integrations and run the workflow again:

```bash
upsun integration:delete INTEGRATION_ID --project PROJECT_ID
```

### Replacing an integration installed by hand

The action does not adopt an integration that you installed by hand. To replace it, delete it with the command above and run the workflow.

### GitHub deployments stop updating

The token in `GH_DEPLOY_TOKEN` has probably expired. The workflow does not find this error, because the workflow does not call GitHub with the token. Create a new token, update the secret, and run the workflow by hand.

### Reading the log of the script

```bash
upsun integration:activities INTEGRATION_ID --project PROJECT_ID
upsun integration:activity:log INTEGRATION_ID ACTIVITY_ID --project PROJECT_ID
```

## Development

The Node version is in `.nvmrc`.

```bash
nvm use
npm ci
npm run check
```

`npm run check` runs Prettier, the TypeScript check, and the tests. `npm run format` corrects the formatting.

## Release

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/). CI lints every commit in a pull request. To lint your commits before you push, run `npm run lint:commits`.

On each push to `main`, semantic-release reads the new commits. A `fix` commit makes a patch release. A `feat` commit makes a minor release. A commit with `!` after the type, or a `BREAKING CHANGE` footer, makes a major release. Other types make no release.

A release creates a Git tag and a GitHub release, updates `CHANGELOG.md` and `package.json`, and moves the major tag. The package is not published to npm or another registry. Consumers use the action from the Git tag.

The release commit is pushed to `main` with the secret `GH_RELEASE_TOKEN`. It holds a personal access token with `Contents: Read and write` on this repository, from an account in the bypass list of the ruleset on `main`.

## References

- [Upsun activity scripts](https://developer.upsun.com/docs/integrations/activity)
- [Upsun activity reference](https://developer.upsun.com/docs/integrations/activity/reference)
- [GitHub Deployments API](https://docs.github.com/en/rest/deployments/deployments)
