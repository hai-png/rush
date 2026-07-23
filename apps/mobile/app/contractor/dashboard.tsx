import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/auth';
import { api as apiClient } from '../../src/lib/api';
import { logout } from '../../src/lib/auth';

type Trip = { id: string; departureAt: string; window: string; status: string; route: { origin: string; destination: string }; shuttle: { plate: string }; seatsBooked: number };

export default function ContractorDashboard() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // MOB-02: surface load errors instead of silently swallowing them.
    // Previously both .catch(() => {}) hid network/401 failures — the user
    // saw an empty list with no indication anything went wrong.
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
        <TouchableOpacity onPress={() => { logout(); router.replace('/auth/login'); }}>
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold' },
  logout: { color: '#dc2626', fontSize: 14 },
  section: { fontSize: 14, color: '#666', paddingHorizontal: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  route: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  btn: { backgroundColor: '#2563eb', borderRadius: 6, padding: 10, marginTop: 8, alignItems: 'center' },
  btnComplete: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
