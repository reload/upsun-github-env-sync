# Upsun Activity Script Setup

This document describes how to set up the GitHub deployment synchronization activity script.

## Overview

The activity script in `activity-script.js` automatically synchronizes Upsun environment states with GitHub Deployments. It responds to environment lifecycle events and creates/updates GitHub deployment statuses accordingly.

## Prerequisites

1. **GitHub Personal Access Token**
   - Create a token at: https://github.com/settings/tokens
   - Required scopes: `repo` (full control, includes deployments)
   - Store the token securely

2. **Upsun CLI**
   - Install: `curl -fsSL https://raw.githubusercontent.com/platformsh/cli/main/installer.sh | bash`
   - Login: `upsun login`

## Development and Validation

### Validating the Activity Script

The activity script can be validated programmatically using TypeScript to catch errors before deploying.

```bash
# From project root
npm run validate:activity-script
```

This runs TypeScript type checking on the activity script using the JSDoc type annotations.

### Type Definitions

The script includes comprehensive JSDoc type definitions for TypeScript validation:

- `UpsunActivity` - The global activity object
- `UpsunActivityPayload` - Activity payload structure
- `Config` - Configuration object
- `GitHubDeployment` - GitHub deployment response
- `GitHubDeploymentStatus` - Deployment status structure

These types enable:
- IDE autocomplete and IntelliSense
- Type checking during development
- Early error detection
- Better documentation

## Installation Steps

### 1. Set Required Project Variables

```bash
# Set GitHub token (required)
upsun variable:create \
  --level project \
  --name GH_TOKEN \
  --value "your-github-token-here" \
  --sensitive true \
  --visible-build false \
  --visible-runtime true

# Set GitHub repository (required - format: owner/repo)
upsun variable:create \
  --level project \
  --name GH_REPO \
  --value "reload/bupl" \
  --visible-build false \
  --visible-runtime true
```

### 2. Validate the Script (Recommended)

Before installing, validate the script locally:

```bash
npm run validate:activity-script
```

### 3. Install the Activity Script

```bash
# From project root
upsun integration:add \
  --type script \
  --file .platform/activity-script.js
```

This will output an integration ID (e.g., `abc123def456`). Save this for future reference.

### 4. Configure Activity Events

The script should respond to these events:

```bash
upsun integration:update \
  --events='environment.push,environment.activate,environment.deactivate,environment.delete' \
  INTEGRATION_ID
```

Replace `INTEGRATION_ID` with the ID from step 3.

### 5. Verify Installation

```bash
# List all integrations
upsun integrations

# View integration details
upsun integration:get INTEGRATION_ID
```

## How It Works

### Event Handling

| Upsun Event | Activity State | GitHub Status | Details |
|-------------|----------------|---------------|---------|
| `environment.push` | pending | queued | Deployment queued |
| `environment.push` | in_progress | in_progress | Links to deployment log |
| `environment.push` | complete (success) | success | Links to environment URL |
| `environment.push` | complete (failure) | failure | Links to deployment log |
| `environment.activate` | complete | success | Environment activated |
| `environment.deactivate` | complete | inactive | Environment closed |
| `environment.delete` | complete | inactive | Environment deleted |

### Deployment Creation

The script automatically creates GitHub deployments when:
- Code is pushed to an environment
- An environment is activated for the first time

The script will:
1. Check if a deployment exists for the environment
2. Create one if it doesn't exist
3. Update the deployment status based on activity state

### Environment Mapping

| Upsun Environment | GitHub Environment Type |
|-------------------|------------------------|
| `main` | Production |
| `pr-*` | Transient (PR preview) |
| `preview-*` | Transient |
| Other branches | Development |

### URLs Generated

**Environment URLs:**
- Production (`main`): `https://www.bupl.dk`
- PR environments: `https://pr-{number}.webtestbupl.dk`
- Other: Extracted from `PLATFORM_ROUTES`

**Log URLs:**
- Format: `https://console.upsun.com/reload-frf/{PROJECT_ID}/-/log/{ACTIVITY_ID}`

## Debugging

### View Activity Script Logs

```bash
# View recent activity script executions
upsun integration:activities INTEGRATION_ID

# View logs for a specific activity
upsun integration:activity:log ACTIVITY_ID
```

### Test the Script Locally

You can validate the script syntax and types locally:

```bash
npm run validate:activity-script
```

Note: This only validates syntax and types. It won't test the actual Upsun integration since the `activity` global is only available in the Upsun runtime.

### Common Issues

**1. TypeScript validation errors**
- Run `npm run validate:activity-script` to see type errors
- Check JSDoc comments are correct
- Ensure all function parameters are documented

**2. "GH_TOKEN variable not set"**
- Ensure the GH_TOKEN variable is created at project level
- Check it's visible at runtime: `upsun variables --level project`

**3. "Failed to create deployment: 404"**
- Verify GH_REPO is correct: format must be `owner/repo`
- Check GitHub token has `repo` scope

**4. "Failed to fetch deployment: 401"**
- GitHub token is invalid or expired
- Recreate token and update variable

**5. Script not triggering**
- Verify events are configured: `upsun integration:get INTEGRATION_ID`
- Check the activity type matches configured events

## Maintenance

### Update the Script

```bash
# After editing activity-script.js

# 1. Validate the changes
npm run validate:activity-script

# 2. Update the integration
upsun integration:update \
  --file .platform/activity-script.js \
  INTEGRATION_ID
```

### Disable the Integration

```bash
upsun integration:delete INTEGRATION_ID
```

### Update GitHub Token

```bash
# Update existing variable
upsun variable:update GH_TOKEN \
  --level project \
  --value "new-token-here"
```

## Continuous Integration

You can add validation to your CI pipeline:

```yaml
# Example GitHub Actions workflow
name: Validate Activity Scripts
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm install
      - name: Validate activity script
        run: npm run validate:activity-script
```

## Related Files

- `.platform/activity-script.js` - The activity script
- `tsconfig.json` - TypeScript configuration (root)
- `package.json` - Node.js dependencies and scripts (root)
- `bin/activity-id` - Helper to get current activity ID
- `bin/activity-type` - Helper to get current activity type
- `bin/primary-route` - Helper to get primary route URL

## References

- [Upsun Activity Scripts Documentation](https://docs.upsun.com/integrations/activity.html)
- [Upsun Activity Reference](https://docs.upsun.com/integrations/activity/reference.html)
- [GitHub Deployments API](https://docs.github.com/en/rest/deployments/deployments)
- [TypeScript JSDoc Reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
