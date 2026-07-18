import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { pendingCount } from '../lib/offline-queue';

export function PendingSyncBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => pendingCount().then(setCount), 5000);
    return () => clearInterval(interval);
  }, []);
  if (count === 0) return null;
  return (
    <View className="bg-warning/10 rounded-full px-3 py-1 self-start flex-row items-center gap-1.5">
      <Text className="text-xs text-warning font-medium">{count} change{count > 1 ? 's' : ''} pending sync</Text>
    </View>
  );
}
