import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function SubscriptionsScreen() {
  const [subs, setSubs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/subscriptions') || [];
      if (!isActive()) return;
      setSubs(data);
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Subscriptions</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={subs}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.planName}>{item.plan?.name}</Text>
              <Text style={[styles.badge, item.status === 'active' && styles.badgeActive]}>{item.status}</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.startDate).toLocaleDateString()} – {new Date(item.endDate).toLocaleDateString()}</Text>
            <Text style={styles.sub}>Rides: {item.ridesUsed} / {item.plan?.ridesIncluded === -1 ? '∞' : item.plan?.ridesIncluded}</Text>
            {item.status === 'active' && (
              <TouchableOpacity onPress={() => api.post(`/subscriptions/${item.id}/renew`, { paymentMethod: 'telebirr' }).then(r => { if (r?.checkout?.checkoutUrl) router.push(r.checkout.checkoutUrl); }).catch(() => alert('Renew failed'))}>
                <Text style={styles.link}>Renew →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No subscriptions. <Text style={styles.link} onPress={() => router.push('/plans')}>Browse plans →</Text></Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  badge: { fontSize: fontSize.xs, color: colors.textMuted, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.badgeBg },
  badgeActive: { color: colors.white, backgroundColor: colors.primary },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  link: { color: colors.primary, fontSize: fontSize.sm, marginTop: spacing.sm },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
