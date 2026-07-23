import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { login } from '../../src/lib/auth';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true);
    setError('');
    try {
      const result = await login(phone, password, needs2FA ? code : undefined);
      if (result.user.role === 'rider') router.replace('/rider/dashboard');
      else if (result.user.role === 'contractor') router.replace('/contractor/dashboard');
      else if (result.user.role === 'corporate_admin') router.replace('/rider/dashboard');
      else if (result.user.role === 'platform_admin') router.replace('/rider/dashboard');
      else router.replace('/rider/dashboard');
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      if (msg.includes('2FA') || msg.includes('Two-factor') || msg.includes('TWO_FACTOR')) {
        setNeeds2FA(true);
        setError('Enter your 6-digit 2FA code below and sign in again');
      } else {
        setError(msg);
      }
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Addis Ride</Text>
      <TextInput
        style={styles.input}
        placeholder="Phone (+2519XXXXXXXX)"
        value={phone}
        onChangeText={setPhone}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {needs2FA && (
        <TextInput
          style={styles.input}
          placeholder="6-digit 2FA code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit} disabled={loading || !phone || !password}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
        <Text style={styles.forgotText}>Forgot password?</Text>
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
  forgotLink: { alignItems: 'center', marginTop: 16 },
  forgotText: { color: '#2563eb', fontSize: 14 },
});
