import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function ListingsScreen() {
  const [listings, setListings] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/marketplace/my-releases') || [];
      if (!isActive()) return;
      setListings(data);
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

  async function cancel(id: string) {
    Alert.alert('Cancel listing?', 'The seat will no longer be available.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: async () => {
        try { await api.post(`/marketplace/seat-releases/${id}/cancel`); load(); }
        catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
      }},
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Seat Listings</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={listings}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            <Text style={styles.sub}>Listed {new Date(item.createdAt).toLocaleDateString()} · expires {new Date(item.expiresAt).toLocaleString()}</Text>
            <View style={styles.row}>
              <Text style={[styles.status, item.status === 'open' && styles.statusOpen]}>{item.status}</Text>
              {item.status === 'open' && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => cancel(item.id)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No listings. <Text style={styles.link} onPress={() => router.push('/rider/list-seat')}>List a seat →</Text></Text>}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  status: { fontSize: fontSize.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.badgeBg, color: colors.textMuted },
  statusOpen: { color: colors.white, backgroundColor: colors.primary },
  cancelBtn: { backgroundColor: colors.errorBg, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  cancelText: { color: colors.error, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  link: { color: colors.primary },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
