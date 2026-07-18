import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { enqueueOrSend } from '../../src/lib/offline-queue';
import { PendingSyncBadge } from '../../src/components/pending-sync-badge';

export default function OpenSeatsScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['seat-releases'],
    queryFn: async () => (await api.GET('/api/v1/seat-releases', { params: { query: { limit: 20 } } })).data,
  });

  const claim = useMutation({
    mutationFn: (seatReleaseId: string) =>
      enqueueOrSend({ method: 'POST', path: '/api/v1/seat-claims', body: { seatReleaseId, paymentMethod: 'telebirr' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seat-releases'] }),
  });

  if (isLoading) return <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>;

  return (
    <View className="flex-1 bg-background px-5 pt-16">
      <Text className="text-xl font-semibold text-foreground mb-2">Open seats</Text>
      <PendingSyncBadge />
      <FlatList
        data={data ?? []}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
        ListEmptyComponent={<Text className="text-muted-foreground text-center mt-12">No open seats right now.</Text>}
        renderItem={({ item }: any) => (
          <View className="rounded-2xl border border-border bg-card p-4 flex-row justify-between items-center">
            <View>
              <Text className="font-medium text-foreground">{item.routeName}</Text>
              <Text className="text-sm text-muted-foreground">{item.releaseDate} · {item.window}</Text>
            </View>
            <Pressable onPress={() => claim.mutate(item.id)} className="bg-foreground rounded-full px-4 py-2">
              <Text className="text-background text-sm font-medium">Claim</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
