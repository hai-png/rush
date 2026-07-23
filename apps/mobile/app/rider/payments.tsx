import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/payments') || [];
      if (!isActive()) return;
      setPayments(data);
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
      <Text style={styles.title}>Payment History</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={payments}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.ref}>{item.reference?.slice(0, 20)}…</Text>
              <Text style={styles.amount}>{item.amountCents / 100} ETB</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.createdAt).toLocaleString()} · {item.method} · {item.subscription?.plan?.name ?? '—'}</Text>
            <Text style={[styles.status, item.status === 'completed' && styles.statusOk, item.status === 'failed' && styles.statusFail]}>{item.status}</Text>
            {item.refundAmountCents > 0 && <Text style={styles.refund}>Refunded: {item.refundAmountCents / 100} ETB</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No payments yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  ref: { fontSize: fontSize.xs, fontFamily: 'monospace', color: colors.textMuted },
  amount: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  status: { fontSize: fontSize.xs, marginTop: spacing.xs, color: colors.textLight },
  statusOk: { color: colors.success },
  statusFail: { color: colors.error },
  refund: { fontSize: fontSize.xs, color: colors.warning, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
