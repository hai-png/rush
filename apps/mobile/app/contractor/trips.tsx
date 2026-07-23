import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function ContractorTripsScreen() {
  const [trips, setTrips] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get<any[]>('/contractor/trips');
      if (!isActive()) return;
      setTrips(data || []);
    } catch (e) {
      if (!isActive()) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
    if (isActive()) setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    load(() => active);
    return () => { active = false; };
  }, [load]));

  async function startTrip(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/board`);
      alert('Trip started');
      load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  async function completeTrip(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/complete`);
      alert('Trip completed');
      load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Trips</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={trips}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.route?.origin} → {item.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.departureAt).toLocaleString()} · {item.shuttle?.plate}</Text>
            <Text style={styles.sub}>{item.seatsBooked}/{item.shuttle?.capacity} seats · {item.status}</Text>
            {item.status === 'scheduled' && (
              <TouchableOpacity style={styles.btn} onPress={() => startTrip(item.id)}>
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
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  route: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  btn: { backgroundColor: colors.primary, borderRadius: 6, padding: 10, marginTop: spacing.sm, alignItems: 'center' },
  btnComplete: { backgroundColor: colors.success },
  btnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
