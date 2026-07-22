import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { restoreSession } from './src/lib/auth';

export default function Index() {
  useEffect(() => {
    restoreSession().then(ok => {
      router.replace(ok ? '/rider/dashboard' : '/auth/login');
    });
  }, []);

  return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
}
