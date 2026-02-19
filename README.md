# Upsun Github Environment Synchonization

This document describes how to set up the GitHub deployment and environment
synchronization activity script on Upsun.

## Overview

The activity script in `activity-script.js` automatically synchronizes Upsun
environment states with GitHub Deployments. It responds to environment lifecycle
events and creates/updates GitHub deployment statuses accordingly.

### Event handling

| Upsun Event                 | Activity State | GitHub Status | Details                  |
|-----------------------------|----------------|---------------|--------------------------|
| `environment.push`          | pending | queued | Deployment queued        |
| `environment.push`          | in_progress | in_progress | Links to deployment log  |
| `environment.push`          | complete (success) | success | Links to environment url |
| `environment.push`          | complete (failure) | failure | Links to deployment log  |
| `environment.activate`      | complete | success | Environment activated    |
| `environment.domain.create` | complete | success | Environment url updated  |
| `environment.domain.delete` | complete | success | Environment url updated  |
| `environment.deactivate`    | complete | inactive | Environment closed       |
| `environment.delete`        | complete | inactive | Environment deleted      |

### Deployment creation

The script automatically creates or updates GitHub deployments when:
- Code is pushed to an environment
- An environment is activated for the first time
- A domain is added or removed for the environment

The script will:
1. Check if a deployment exists for the environment
2. Create one if it doesn't exist
3. Update the deployment status based on activity state

### URLs generated

* Environment url: Extracted from the Upsun primary route
* Log url: Use the format `https://console.upsun.com/{OWNER_SLUG}/{PROJECT_ID}/-/log/{ACTIVITY_ID}`

## Prerequisites

1. **GitHub Personal Access Token**
   - Create a token at: https://github.com/settings/personal-access-tokens/new
   - Repository access: Select the repository for the project
   - Permissions:
     - Metadata: Read only (default)
     - Deployments: Read and write
     - Environments: Read and write
   - Store the token securely

2. **Upsun CLI**
   - Install: `curl -fsSL https://raw.githubusercontent.com/platformsh/cli/main/installer.sh | bash`
   - Login: `upsun login`

## Development and validation

### 1. Install the activity script

```bash
upsun integration:add \
  --type script \
  --file .platform/activity-scripts/upsun-github-env-sync/activity-script.js \
  --events='environment.push,environment.activate,environment.domain.create,environment.domain.delete,environment.deactivate,environment.delete' \
  --states='*' \
  --environments='*'
```

### 2. Set required integration variables

```bash
# Set GitHub token (required)
upsun api:curl /api/projects/[PROJECT_ID]/integrations/[INTEGRATION_ID]/variables -X POST --json="{
  \"name\": \"GH_TOKEN\",
  \"value\": \"[GITHUB_TOKEN]\",
  \"is_sensitive\": true
}"

# Set GitHub repository (required - format: owner/repo, no [])
upsun api:curl /api/projects/[PROJECT_ID]/integrations/[INTEGRATION_ID]/variables -X POST --json="{
  \"name\": \"GH_REPO\",
  \"value\": \"[GITHUB OWNER]/[GITHUB REPOSITORY]\"
}"
```

## Debugging

### View activity script logs

```bash
# View recent activity script executions
upsun integration:activities INTEGRATION_ID

# View logs for a specific activity
upsun integration:activity:log INTEGRATION_ID ACTIVITY_ID
```

## Maintenance

### Update the Script

```bash
# After editing activity-script.js

# 1. Validate the changes
npm run activity-script:lint

# 2. Update the integration
upsun integration:update \
  --file .platform/activity-scripts/upsun-github-env-sync/activity-script.js \
  INTEGRATION_ID
```

### Disable the integration

```bash
upsun integration:delete INTEGRATION_ID
```

## References

- [Upsun Activity Scripts Documentation](https://docs.upsun.com/integrations/activity.html)
- [Upsun Activity Reference](https://docs.upsun.com/integrations/activity/reference.html)
- [GitHub Deployments API](https://docs.github.com/en/rest/deployments/deployments)
