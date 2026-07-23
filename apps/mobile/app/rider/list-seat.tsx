import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function ListSeatScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const allRides = await api.get('/rides') || [];
      if (!isActive()) return;
      setRides(allRides.filter((r: any) => r.status === 'booked' && r.trip?.status === 'scheduled'));
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

  async function listSeat(ride: any) {
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    try {
      await api.post('/marketplace/seat-releases', { tripId: ride.tripId, window: ride.trip?.window || 'morning', expiresAt });
      Alert.alert('Success', 'Seat listed on marketplace');
      router.replace('/rider/listings');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>List a Seat for Sale</Text>
      <Text style={styles.desc}>Can't make a trip? List your seat for another rider to claim.</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={rides}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            <Text style={styles.fare}>{item.trip?.route?.fareCents / 100} ETB</Text>
            <TouchableOpacity style={styles.btn} onPress={() => listSeat(item)}>
              <Text style={styles.btnText}>List This Seat</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming booked rides to release.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  desc: { fontSize: fontSize.sm, color: colors.textMuted, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  route: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  fare: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary, marginTop: spacing.xs },
  btn: { backgroundColor: colors.primary, borderRadius: 6, padding: 10, marginTop: spacing.sm, alignItems: 'center' },
  btnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
