# Addis Ride Mobile

Expo React Native app for riders and contractors.

## Setup

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) or press `a` for Android emulator / `i` for iOS simulator.

## Features

- **Auth**: phone + password login, session persisted via SecureStore
- **Rider dashboard**: active subscription, available route assignments with pickup locations
- **Trip browsing**: upcoming trips filtered by assignment
- **Ride booking**: choose pickup location, book against subscription
- **Notifications**: list with unread indicators
- **Contractor dashboard**: assigned trips, start/complete trip actions

## API

The app talks to the web app's API at `http://10.0.2.2:3000` (Android emulator) or `http://localhost:3000` (web). Change `API_BASE` in `src/lib/api.ts` for production.
