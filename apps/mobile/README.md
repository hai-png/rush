# Addis Ride Mobile

Expo React Native app for riders and contractors. Rider + contractor flows share a single auth path (one login form, role-based redirect at `app/index.tsx`) and one API client (`src/lib/api.ts`).

## Stack

- Expo SDK 51 + React Native 0.74 + expo-router 3.5
- Zustand for auth + settings state
- `react-native-maps` for trip / live-trip map views
- `expo-secure-store` for the session JWT (encrypted at rest)
- `expo-local-authentication` for biometric gate
- `expo-location` + `expo-notifications` for live-trip + push
- Single source of truth for design tokens: `src/lib/theme.ts` (colors / spacing / radius / typography) — no screen uses raw hex codes
- Offline queue: `src/lib/offline-queue.ts` retries failed writes when connectivity returns

## Setup

```bash
cd apps/mobile
bun install          # or: npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) or press `a` for Android emulator / `i` for iOS simulator.

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `EXPO_PUBLIC_API_BASE` | `http://10.0.2.2:3000` (Android) / `http://localhost:3000` (web) | Override for production. Production builds reject `http://` URLs unless `EXPO_PUBLIC_API_ALLOW_HTTP=1` is set. |
| `EXPO_PUBLIC_API_ALLOW_HTTP` | unset | Set to `1` to bypass the https-only check in dev. **Not recommended in production.** |

## Features

- **Auth**: phone + password login, single auth path; session persisted via SecureStore; biometric gate on app launch
- **Rider dashboard**: active subscription, available route assignments with pickup locations
- **Trip browsing**: upcoming trips filtered by assignment
- **Ride booking**: choose pickup location, book against subscription
- **List seat**: release a seat you can't use to the marketplace
- **Live trip**: real-time shuttle position (uses `react-native-maps`)
- **Notifications**: list with unread indicators
- **Tickets**: open + view support tickets
- **Contractor dashboard**: assigned trips, start/complete trip actions
- **Contractor GPS tracker**: push shuttle position to the API for the live-trip view

## API

The app talks to the web app's API at `EXPO_PUBLIC_API_BASE` (see table above). Change `src/lib/api.ts` for advanced configuration. All requests are prefixed with `/api/v1`.
