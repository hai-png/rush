import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

export default function LoginScreen() {
  const [phone, setPhone] = useState('+251');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);

  const submit = async () => {
    setLoading(true); setError(null);
    const { data, error: apiError } = await api.POST('/api/v1/auth/token', { body: { phone, password } });
    setLoading(false);
    if (apiError || !data) { setError('Invalid phone number or password'); return; }
    await setAuth((data as any).accessToken, (data as any).user.role);
    router.replace('/(rider)/dashboard');
  };

  return (
    <View className="flex-1 justify-center px-6 bg-background">
      <Text className="text-2xl font-semibold text-center mb-8 text-foreground">Welcome back</Text>
      <Text className="text-sm font-medium mb-1 text-foreground">Phone number</Text>
      <TextInput
        value={phone} onChangeText={setPhone} keyboardType="phone-pad"
        className="h-12 rounded-xl border border-border px-3 mb-4 text-foreground"
        accessibilityLabel="Phone number"
      />
      <Text className="text-sm font-medium mb-1 text-foreground">Password</Text>
      <TextInput
        value={password} onChangeText={setPassword} secureTextEntry
        className="h-12 rounded-xl border border-border px-3 mb-2 text-foreground"
        accessibilityLabel="Password"
      />
      {error && <Text className="text-destructive text-sm mb-2">{error}</Text>}
      <Pressable onPress={submit} disabled={loading} className="h-12 rounded-xl bg-foreground items-center justify-center mt-4">
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-background font-medium">Log in</Text>}
      </Pressable>
      <Pressable onPress={() => router.push('/(auth)/signup')} className="mt-4">
        <Text className="text-center text-accent text-sm">Create an account</Text>
      </Pressable>
    </View>
  );
}
