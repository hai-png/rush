import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<'send' | 'verify'>('send');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    try { await api.post('/auth/password/reset', { phone }); setStep('verify'); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  async function verify() {
    setLoading(true);
    try {
      await api.post('/auth/password/reset/confirm', { phone, code, newPassword: newPw });
      alert('Password reset — sign in');
      router.replace('/auth/login');
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <Text style={styles.title}>Reset Password</Text>
      {step === 'send' ? (
        <>
          <TextInput style={styles.input} placeholder="Phone (+2519XXXXXXXX)" value={phone} onChangeText={setPhone} autoCapitalize="none" />
          <TouchableOpacity style={styles.btn} onPress={send} disabled={loading || !phone}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput style={styles.input} placeholder="6-digit code" value={code} onChangeText={setCode} maxLength={6} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="New password (min 10 chars)" value={newPw} onChangeText={setNewPw} secureTextEntry />
          <TouchableOpacity style={styles.btn} onPress={verify} disabled={loading || !code || newPw.length < 10}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
