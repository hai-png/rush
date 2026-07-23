import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { api as apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

type Trip = { id: string; departureAt: string; window: string; status: string; route: { origin: string; destination: string }; shuttle: { plate: string }; seatsBooked: number };

export default function ContractorDashboard() {
  const logout = useAuthStore(s => s.logout);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([
      apiClient.get<Trip[]>('/contractor/trips').then(d => { if (!cancelled) setTrips(d || []); }),
      apiClient.get<any[]>('/contractor/assignments').then(d => { if (!cancelled) setAssignments(d || []); }),
    ]).catch((e) => {
      if (cancelled) return;
      setLoadError(e instanceof Error ? e.message : 'Failed to load dashboard');
      setTrips([]);
      setAssignments([]);
    });
    return () => { cancelled = true; };
  }, []);

  async function boardTrip(tripId: string) {
    try {
      await apiClient.post(`/trips/${tripId}/board`);
      Alert.alert('Success', 'Trip started — passengers boarded');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  async function completeTrip(tripId: string) {
    try {
      await apiClient.post(`/trips/${tripId}/complete`);
      Alert.alert('Success', 'Trip completed');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Trips</Text>
        <TouchableOpacity onPress={async () => { await logout(); router.replace('/auth/login'); }}>
          <Text style={styles.logout}>Sign Out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.section}>Assignments: {assignments.length}</Text>
      {loadError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn&apos;t load: {loadError}</Text>
          <Text style={styles.errorHint}>Pull down or reopen the screen to retry.</Text>
        </View>
      )}
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.route.origin} → {item.route.destination}</Text>
            <Text style={styles.sub}>{new Date(item.departureAt).toLocaleString()} · {item.shuttle.plate}</Text>
            <Text style={styles.sub}>{item.seatsBooked} seats booked · {item.status}</Text>
            {item.status === 'scheduled' && (
              <TouchableOpacity style={styles.btn} onPress={() => boardTrip(item.id)}>
                <Text style={styles.btnText}>Start Trip</Text>
              </TouchableOpacity>
            )}
            {item.status === 'in_transit' && (
              <TouchableOpacity style={[styles.btn, styles.btnComplete]} onPress={() => completeTrip(item.id)}>
                <Text style={styles.btnText}>Complete Trip</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No trips assigned</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  logout: { color: colors.error, fontSize: fontSize.sm },
  section: { fontSize: fontSize.sm, color: colors.textMuted, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  route: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  btn: { backgroundColor: colors.primary, borderRadius: 6, padding: 10, marginTop: spacing.sm, alignItems: 'center' },
  btnComplete: { backgroundColor: colors.success },
  btnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBox: { backgroundColor: colors.errorBg, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  errorText: { color: colors.errorText, fontSize: fontSize.sm },
  errorHint: { color: colors.errorText, fontSize: fontSize.xs, marginTop: spacing.xs },
});
