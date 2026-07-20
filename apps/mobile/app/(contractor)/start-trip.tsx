import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { setActiveShuttleId } from './gps-tracker';

/**
 * Mobile trip-start screen for contractors.
 *
 * FIX (MOB-007): The previous implementation had no mobile trip-start flow.
 * The gps-tracker.tsx background task reads `addisride.activeShuttleId` from
 * SecureStore, but no code ever wrote it — so GPS tracking was always a no-op.
 * This screen lets the contractor:
 *   1. Select their assigned shuttle + route + window
 *   2. POST /api/v1/trips (server stamps departTime)
 *   3. Call setActiveShuttleId(shuttleId) so the GPS background task runs
 *   4. Navigate to the GPS tracker screen
 */
export default function ContractorStartTripScreen() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['contractor-dashboard'],
    queryFn: async () => (await api.GET('/api/v1/dashboard/contractor')).data,
  });

  const startTrip = useMutation({
    mutationFn: async (input: { shuttleId: string; routeId: string; window: 'morning' | 'evening' }) =>
      api.POST('/api/v1/trips', { body: input } as any),
    onSuccess: async (_res, variables) => {
      // FIX (MOB-007): Write the shuttleId to SecureStore so the background
      // GPS task can report positions.
      await setActiveShuttleId(variables.shuttleId);
      qc.invalidateQueries({ queryKey: ['contractor-dashboard'] });
      router.push('/(contractor)/gps-tracker');
    },
  });

  const d = profile as any;
  const shuttleId = d?.shuttleId;
  const routeId = d?.routeId;
  const canStart = shuttleId && routeId && d?.verificationStatus === 'verified';

  if (!d) return <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>;

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-xl font-semibold mb-4">Start Trip</Text>
      {!canStart && (
        <Text className="text-sm text-muted-foreground text-center mb-4">
          {d?.verificationStatus !== 'verified'
            ? 'Your account is pending verification. You cannot start trips until an admin approves your documents.'
            : 'No shuttle or route assigned. Contact support.'}
        </Text>
      )}
      <Pressable
        disabled={!canStart || startTrip.isPending}
        onPress={() => startTrip.mutate({ shuttleId, routeId, window: 'morning' })}
        className={`px-6 py-3 rounded-xl ${canStart && !startTrip.isPending ? 'bg-primary' : 'bg-muted'}`}
      >
        <Text className="text-primary-foreground font-medium">
          {startTrip.isPending ? 'Starting...' : 'Start Morning Trip'}
        </Text>
      </Pressable>
      {startTrip.error && (
        <Text className="text-sm text-destructive mt-2">
          {(startTrip.error as any)?.message ?? 'Failed to start trip'}
        </Text>
      )}
    </View>
  );
}
