import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Linking } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

type Release = {
  id: string;
  trip: { route: { origin: string; destination: string; fareCents: number }; shuttle: { plate: string }; departureAt: string };
  window: string;
  expiresAt: string;
};

export default function OpenSeatsScreen() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await api.get<Release[]>('/marketplace/seat-releases');
      if (!isActive()) return;
      setReleases(data || []);
    } catch (e) {
      if (!isActive()) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
      setReleases([]);
    }
    if (isActive()) setRefreshing(false);
  }, []);

  // (MOB-05e — active guard prevents stale setState on blur.)
  useFocusEffect(useCallback(() => {
    let active = true;
    load(() => active);
    return () => { active = false; };
  }, [load]));

  async function claim(releaseId: string) {
    try {
      const r = await api.post<any>(`/marketplace/seat-releases/${releaseId}/claim`, { paymentMethod: 'telebirr' });
      const url = r?.checkout?.checkoutUrl;
      if (!url) {
        Alert.alert('Claim succeeded', 'Your seat claim was confirmed. Check your rides.');
        router.push('/rider/rides');
        return;
      }
      // checkoutUrl is an EXTERNAL URL (Telebirr or /telebirr-stub).
      // Expo Router's router.push only handles internal routes — using it
      // throws "Could not find route" and silently fails the claim.
      // Use Linking.openURL for external URLs.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot open checkout', `URL: ${url}`);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Claim failed', e instanceof Error ? e.message : 'Please try again');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seat Marketplace</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={releases}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => claim(item.id)}>
            <Text style={styles.route}>{item.trip.route.origin} → {item.trip.route.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip.departureAt).toLocaleString()} · {item.trip.shuttle.plate}</Text>
            <Text style={styles.fare}>{item.trip.route.fareCents / 100} ETB</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{error ? '' : 'No open seats'}</Text>}
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
  fare: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary, marginTop: spacing.xs },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
