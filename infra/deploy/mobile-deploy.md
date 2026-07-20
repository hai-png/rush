# Mobile App Deployment Checklist

## INFRA-006: placeholder EAS project IDs

The `apps/mobile/app.json` contains placeholders that MUST be replaced
before building:

- `extra.eas.projectId`: `"REPLACE_WITH_REAL_EAS_PROJECT_UUID"`
- `updates.url`: `"https://u.expo.dev/REPLACE_WITH_REAL_EAS_PROJECT_UUID"`

## Steps

1. Create an EAS project:
   ```sh
   npx eas-cli create --name addis-ride
   ```
   Copy the project ID from the EAS dashboard.

2. Replace the placeholders in `apps/mobile/app.json`:
   - `extra.eas.projectId` → the real project ID (a UUID).
   - `updates.url` → `https://u.expo.dev/<real-project-id>`.

3. Set the `EXPO_PUBLIC_API_URL` env var (for the JS bundle):
   - Staging: `https://staging.addisride.et`
   - Production: `https://addisride.et`
   This is read by `apps/mobile/src/lib/api.ts`. Without it, the mobile
   app can't reach the API.

4. Configure EAS Build profiles in `eas.json` (not yet committed — create
   one based on the Expo defaults). Use `production` channel for production
   builds, `staging` for staging.

5. Set up Sentry for React Native:
   - `npx @sentry/wizard@latest -i reactNative -p android ios`
   - Set `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
     in EAS secrets.

6. Build and submit:
   ```sh
   eas build --platform all --profile production
   eas submit --platform all --profile production
   ```

## OTA updates

OTA updates are configured (`updates.url` in app.json, `runtimeVersion:
{ policy: 'appVersion' }`). To push an OTA update:

```sh
eas update --branch production --message "fix: ..."
```

Native code changes (new dependencies, new native modules) require a new
binary build via `eas build` — OTA can't ship native changes.

## Required secrets (EAS)

Set these in EAS secrets (`eas secret:create`):

- `EXPO_PUBLIC_API_URL`
- `SENTRY_DSN`
- `EXPO_ACCESS_TOKEN` (for push notifications — same as the worker)
