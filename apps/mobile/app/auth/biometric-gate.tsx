import { View, Text, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { useAuthStore } from '../../src/lib/auth-store';
import { router } from 'expo-router';

export default function BiometricGate() {
  const { restore, user } = useAuthStore();

  useEffect(() => {
    restore().then(ok => {
      router.replace(ok ? '/rider/dashboard' : '/auth/login');
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Addis Ride</Text>
      <Text style={styles.loading}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2563eb' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  loading: { fontSize: 16, color: '#fff' },
});
