import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';

type Pickup = { id: string; name: string; estimatedPickupTime: string };

export default function BookScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    // only fetched /subscriptions and left `pickups` as [], so the screen
    // title said "Choose Pickup Location" but the list was always empty.
    Promise.all([
      api.get<any>('/subscriptions').then(s => setSubs((s || []).filter((x: any) => x.status === 'active'))).catch(() => setSubs([])),
      api.get<any>('/trips').then((trips: any) => {
        const trip = (trips || []).find((t: any) => t.id === tripId);
        if (trip?.route?.pickups) {
          setPickups(trip.route.pickups.filter((p: any) => p.isActive !== false));
        } else if (trip?.routeId) {
          // Fall back to fetching pickups via the catalog endpoint if the trip
          // response doesn't include nested pickups.
          return api.get<any>(`/routes/${trip.routeId}/pickups`).then((p: any) => setPickups(p || [])).catch(() => setPickups([]));
        }
      }).catch(() => setPickups([])),
    ]).finally(() => setLoading(false));
  }, [tripId]);

  async function book(pickupId?: string) {
    if (subs.length === 0) {
      Alert.alert('No subscription', 'You need an active subscription to book a ride.');
      return;
    }
    setBooking(true);
    try {
      await api.post('/rides', { tripId, subscriptionId: subs[0].id, pickupLocationId: pickupId });
      Alert.alert('Success', 'Ride booked!', [{ text: 'OK', onPress: () => router.replace('/rider/dashboard') }]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Booking failed');
    } finally { setBooking(false); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose Pickup Location</Text>
      <FlatList
        data={pickups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => book(item.id)} disabled={booking}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardSub}>Pickup ~{item.estimatedPickupTime}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <TouchableOpacity style={styles.card} onPress={() => book()} disabled={booking}>
            <Text style={styles.cardTitle}>Book without pickup preference</Text>
          </TouchableOpacity>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 12, color: '#666', marginTop: 4 },
});
