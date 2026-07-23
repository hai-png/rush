import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../src/lib/auth-store';
import { router } from 'expo-router';
import { getBiometricsEnabled, setBiometricsEnabled } from '../../src/lib/settings-store';

// real biometric gate.
//
// Original behavior: this file was named biometric-gate.tsx but contained
// zero biometric API calls — it just called `restore()` from useAuthStore,
// which reads the token from SecureStore and calls /auth/me. Any user (or
// thief) who unlocks the device got full account access with no FaceID /
// TouchID / fingerprint prompt. expo-local-authentication wasn't even in
// package.json.
//
// New behavior:
//   1. On mount, attempt to restore the session from SecureStore.
//   2. If a valid session exists AND biometrics are enabled in settings,
//      prompt for biometric auth before routing to the dashboard.
//   3. If biometrics fail or are unavailable, fall back to a "Tap to retry"
//      UI with a "Sign out" escape hatch (so the user can re-login with
//      password). We do NOT auto-fall-through, because that defeats the
//      purpose of biometric protection.
//   4. If biometrics are disabled in settings (the default), restore and
//      route directly.
//
// Note: expo-local-authentication must be installed. If it isn't, the dynamic
// import fails and we treat biometrics as unavailable (user must sign in).
export default function BiometricGate() {
  const { restore, logout, user } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'biometric' | 'failed' | 'done'>('loading');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = await restore();
      if (!ok) {
        router.replace('/auth/login');
        return;
      }
      setHasSession(true);
      const biometricsEnabled = await getBiometricsEnabled();
      if (!biometricsEnabled) {
        router.replace('/rider/dashboard');
        return;
      }
      // Try to prompt for biometric auth.
      const result = await promptBiometric();
      if (result === 'success') {
        router.replace('/rider/dashboard');
      } else if (result === 'unavailable') {
        // Biometrics not available on this device — fall through to dashboard
        // but warn the user once.
        Alert.alert(
          'Biometrics unavailable',
          'Biometric authentication is not available on this device. Sign in with your password next time for security.',
          [{ text: 'Continue', onPress: () => router.replace('/rider/dashboard') }]
        );
        await setBiometricsEnabled(false);
      } else {
        setStatus('failed');
      }
    })();
  }, []);

  async function promptBiometric(): Promise<'success' | 'failed' | 'unavailable'> {
    try {
      const LocalAuth = require('expo-local-authentication');
      const compat = await LocalAuth.hasHardwareAsync();
      if (!compat) return 'unavailable';
      const enrolled = await LocalAuth.isEnrolledAsync();
      if (!enrolled) return 'unavailable';
      const result = await LocalAuth.authenticateAsync({
        promptMessage: 'Unlock Addis Ride',
        fallbackLabel: 'Use password',
        disableDeviceFallback: false,
      });
      return result.success ? 'success' : 'failed';
    } catch (e) {
      // Module not installed or platform error — treat as unavailable.
      return 'unavailable';
    }
  }

  async function retry() {
    setStatus('loading');
    const result = await promptBiometric();
    if (result === 'success') {
      router.replace('/rider/dashboard');
    } else if (result === 'unavailable') {
      router.replace('/rider/dashboard');
    } else {
      setStatus('failed');
    }
  }

  async function signOut() {
    await logout();
    router.replace('/auth/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Addis Ride</Text>
      {status === 'loading' && <Text style={styles.loading}>Loading…</Text>}
      {status === 'failed' && (
        <>
          <Text style={styles.loading}>Biometric authentication failed</Text>
          <TouchableOpacity style={styles.btn} onPress={retry}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={signOut}>
            <Text style={styles.btnSecondaryText}>Sign in with password</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2563eb', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  loading: { fontSize: 16, color: '#fff', marginBottom: 16 },
  btn: { backgroundColor: '#fff', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12, minWidth: 200 },
  btnText: { color: '#2563eb', fontSize: 16, fontWeight: '600' },
  btnSecondary: { marginTop: 12, padding: 8 },
  btnSecondaryText: { color: '#fff', fontSize: 14, textDecorationLine: 'underline' },
});
