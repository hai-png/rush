import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { api, setToken } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function SignupScreen() {
  const setUser = useAuthStore(s => s.setUser);
  const [form, setForm] = useState({ name: '', phone: '', password: '', homeArea: '', workArea: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      await api.post('/auth/register', { kind: 'rider', ...form });
      const result = await api.post<{ accessToken: string; user: any }>('/auth/token', { phone: form.phone, password: form.password });
      setToken(result.accessToken);
      await SecureStore.setItemAsync('session', result.accessToken);
      setUser(result.user);
      router.replace('/rider/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally { setLoading(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      <Text style={styles.title}>Create Account</Text>
      <TextInput style={styles.input} placeholder="Full name" value={form.name} onChangeText={v => setForm({ ...form, name: v })} />
      <TextInput style={styles.input} placeholder="Phone (+2519XXXXXXXX)" value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Password (min 10 chars)" value={form.password} onChangeText={v => setForm({ ...form, password: v })} secureTextEntry />
      <TextInput style={styles.input} placeholder="Home area (e.g. Bole)" value={form.homeArea} onChangeText={v => setForm({ ...form, homeArea: v })} />
      <TextInput style={styles.input} placeholder="Work area (e.g. Merkato)" value={form.workArea} onChangeText={v => setForm({ ...form, workArea: v })} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Sign Up</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/auth/login')}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.surface },
  title: { fontSize: 28, fontWeight: fontWeight.bold, textAlign: 'center', marginBottom: spacing.lg, color: colors.text },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginBottom: 10, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.borderSubtle },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  error: { color: colors.error, textAlign: 'center', marginBottom: 10 },
  link: { color: colors.primary, textAlign: 'center', marginTop: spacing.md, fontSize: fontSize.sm },
});
