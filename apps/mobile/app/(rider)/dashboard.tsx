import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { api } from '../../src/lib/api';

export default function RiderDashboardScreen() {
  const { data, refetch } = useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: async () => (await api.GET('/api/v1/dashboard/rider')).data,
  });
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <View className="px-5 pt-16">
        <Text className="text-2xl font-semibold text-foreground leading-tight">
          Every commute starts{'\n'}with a confirmed seat.
        </Text>
      </View>

      {(data as any)?.activeSubscription ? (
        <View className="mx-5 mt-6 rounded-3xl border border-border bg-card p-4">
          <View className="flex-row justify-between items-center">
            <Text className="text-sm text-muted-foreground">Active plan</Text>
            <View className="bg-primary/10 rounded-full px-2 py-1">
              <Text className="text-xs text-primary font-medium">{(data as any).activeSubscription.status}</Text>
            </View>
          </View>
          <Text className="text-lg font-semibold text-foreground mt-1">{(data as any).activeSubscription.plan.name}</Text>
          <Pressable
            onPress={() => router.push(`/(rider)/live-trip?subscriptionId=${(data as any).activeSubscription.id}`)}
            className="mt-3 bg-foreground rounded-full py-3 items-center"
          >
            <Text className="text-background font-medium">Track today's shuttle</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => router.push('/(rider)/plans')} className="mx-5 mt-6 rounded-3xl border border-dashed border-border p-6 items-center">
          <Text className="font-medium text-foreground">No active subscription</Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">Browse plans to reserve your daily seat</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
