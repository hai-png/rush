/// <reference types="nativewind/types" />

// FOLLOW-UP 4: NativeWind type augmentation. Without this reference, the
// `className` prop on RN primitives (View, Text, Pressable) is not recognized
// by TypeScript, causing ~119 typecheck errors across the mobile app. The
// `nativewind/types` package augments the React Native type definitions to
// add `className?: string` to all primitive components.
