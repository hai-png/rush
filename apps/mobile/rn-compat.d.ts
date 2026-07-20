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
