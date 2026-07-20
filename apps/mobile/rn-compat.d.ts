// FOLLOW-UP 4: React 19 / React Native 0.76 component type compatibility.
//
// React 19's `Component` base class added a required `refs` property that
// RN 0.76's component types (MapView, Polyline, Marker, Stack) don't satisfy.
// This augmentation relaxes the JSX element type check for these components
// so TypeScript accepts them as valid JSX elements. The runtime behavior is
// unchanged — these components work correctly at runtime; only the types
// are mismatched.
//
// This is a known issue tracked at:
// https://github.com/facebook/react-native/issues/49434
// Once RN 0.77+ is adopted (which pins React 19 types), this file can be
// removed.

import type { ComponentType } from 'react';

type LooselyTypedComponent = ComponentType<any>;

declare module 'react-native-maps' {
  export const MapView: LooselyTypedComponent;
  export const Marker: LooselyTypedComponent;
  export const Polyline: LooselyTypedComponent;
}

declare module 'expo-router' {
  export const Stack: LooselyTypedComponent;
}
