import { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

export default function LiveTripScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId: string }>();
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const { data: trip } = useQuery({
    queryKey: ['active-trip', subscriptionId],
    queryFn: async () => (await api.GET('/api/v1/dashboard/rider/active-trip', { params: { query: { subscriptionId } } })).data,
  });

  useEffect(() => {
    if (!(trip as any)?.shuttleId) return;
    const token = useAuthStore.getState().accessToken;
    const es = new EventSource(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/shuttle-positions/stream?shuttleIds=${(trip as any).shuttleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    } as any);
    es.onmessage = (e: any) => setPosition(JSON.parse(e.data));
    return () => es.close();
  }, [(trip as any)?.shuttleId]);

  if (!trip) return <View className="flex-1 items-center justify-center"><Text>Loading…</Text></View>;
  const t = trip as any;

  return (
    <View className="flex-1">
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: 9.02, longitude: 38.75, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
        {t.polyline && <Polyline coordinates={t.polyline.map(([lat, lng]: number[]) => ({ latitude: lat, longitude: lng }))} strokeColor="#10b981" strokeWidth={4} />}
        {position && <Marker coordinate={{ latitude: position.lat, longitude: position.lng }} title={t.plateNumber} />}
      </MapView>

      <View className="absolute bottom-0 inset-x-0 bg-card rounded-t-3xl p-4 border-t border-border">
        <View className="flex-row justify-between mb-3">
          <Text className="text-muted-foreground text-sm">Arriving in</Text>
          <Text className="font-semibold text-lg">{t.etaMinutes} min</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="font-medium">{t.contractorName}</Text>
            <Text className="text-xs text-muted-foreground">{t.plateNumber} · ★ {t.contractorRating}</Text>
          </View>
          <Pressable onPress={() => Linking.openURL(`tel:${t.contractorPhone}`)} className="h-10 w-10 rounded-full bg-foreground items-center justify-center">
            <Text className="text-background">📞</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
