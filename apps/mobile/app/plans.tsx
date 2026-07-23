import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/lib/theme';

export default function PlansScreen() {
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/plans') || [];
      if (!isActive()) return;
      setPlans(data);
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

  async function subscribe(planId: string) {
    try {
      const res = await api.post('/subscriptions', { planId, paymentMethod: 'telebirr' });
      if (res?.checkout?.checkoutUrl) router.push(res.checkout.checkoutUrl);
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Subscription Plans</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={plans}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.planName}>{item.name}</Text>
            <Text style={styles.planDesc}>{item.description}</Text>
            <Text style={styles.price}>{item.priceCents === 0 ? 'Free' : `${item.priceCents / 100} ETB`}<Text style={styles.priceSub}> / {item.durationDays}d</Text></Text>
            <Text style={styles.rides}>{item.ridesIncluded === -1 ? 'Unlimited rides' : `${item.ridesIncluded} rides`}</Text>
            <TouchableOpacity style={styles.btn} onPress={() => subscribe(item.id)}>
              <Text style={styles.btnText}>Subscribe</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  planName: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  planDesc: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.sm, color: colors.primary },
  priceSub: { fontSize: fontSize.sm, fontWeight: fontWeight.normal, color: colors.textLight },
  rides: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 12, alignItems: 'center', marginTop: 12 },
  btnText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
