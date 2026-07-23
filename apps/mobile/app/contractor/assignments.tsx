import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function ContractorAssignmentsScreen() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/contractor/assignments') || [];
      if (!isActive()) return;
      setAssignments(data);
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

  async function accept(id: string) {
    try { await api.post(`/assignments/${id}/accept`); load(); }
    catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  async function reject(id: string) {
    Alert.alert('Reject assignment?', 'Provide a reason', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', onPress: async () => {
        try { await api.post(`/assignments/${id}/reject`, { reason: 'Rejected from mobile' }); load(); }
        catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
      }},
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Route Assignments</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={assignments}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => {
          const pattern = JSON.parse(item.schedulePattern);
          return (
            <View style={styles.card}>
              <Text style={styles.route}>{item.route?.origin} → {item.route?.destination}</Text>
              <Text style={styles.sub}>Shuttle: {item.shuttle?.plate} ({item.shuttle?.capacity} seats)</Text>
              <Text style={styles.sub}>Month: {new Date(item.monthStart).toLocaleDateString()} – {new Date(item.monthEnd).toLocaleDateString()}</Text>
              <Text style={styles.sub}>Schedule: {pattern.days?.join(', ')} · {pattern.windows?.join(', ')}</Text>
              <Text style={styles.sub}>{item._count?.trips ?? 0} trips · {item._count?.rides ?? 0} rides</Text>
              <View style={styles.row}>
                <Text style={[styles.status, item.status === 'active' && styles.statusActive]}>{item.status}</Text>
                {item.status === 'assigned' && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => accept(item.id)}><Text style={styles.acceptText}>Accept</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(item.id)}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No assignments yet</Text>}
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
  statusActive: { color: colors.white, backgroundColor: colors.success },
  actions: { flexDirection: 'row', gap: spacing.sm },
  acceptBtn: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  acceptText: { color: colors.white, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  rejectBtn: { backgroundColor: colors.errorBg, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginLeft: spacing.sm },
  rejectText: { color: colors.error, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
