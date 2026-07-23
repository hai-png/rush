import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/lib/auth-store';
import { colors } from '../src/lib/theme';

export default function Index() {
  const restore = useAuthStore(s => s.restore);

  useEffect(() => {
    let active = true;
    restore().then(ok => {
      if (!active) return;
      router.replace(ok ? '/rider/dashboard' : '/auth/login');
    });
    return () => { active = false; };
  }, [restore]);

  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.surface }}><ActivityIndicator size="large" color={colors.primary} /></View>;
}
