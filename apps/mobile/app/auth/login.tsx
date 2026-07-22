import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { login } from '../../src/lib/auth';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true);
    setError('');
    try {
      const result = await login(phone, password);
      if (result.user.role === 'rider') router.replace('/rider/dashboard');
      else if (result.user.role === 'contractor') router.replace('/contractor/dashboard');
      else router.replace('/rider/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Addis Ride</Text>
      <TextInput style={styles.input} placeholder="Phone (+2519XXXXXXXX)" value={phone} onChangeText={setPhone} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f5f5' },
  title: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginBottom: 32, color: '#1a1a1a' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 12, fontSize: 14 },
});
