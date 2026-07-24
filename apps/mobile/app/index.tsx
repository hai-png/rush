import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/lib/auth-store';
import { colors } from '../src/lib/theme';
import { routeByRole } from '../src/lib/route-by-role';

export default function Index() {
  const restore = useAuthStore(s => s.restore);

  useEffect(() => {
    let active = true;
    restore().then(ok => {
      if (!active) return;
      if (!ok) {
        router.replace('/auth/login');
        return;
      }
      // H-29 fix: route by role instead of hardcoding /rider/dashboard.
      const user = useAuthStore.getState().user;
      router.replace(routeByRole(user?.role));
    });
    return () => { active = false; };
  }, [restore]);

  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.surface }}><ActivityIndicator size="large" color={colors.primary} /></View>;
}
