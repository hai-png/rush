import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/lib/auth-store';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

// mobile login now supports 2FA.
//
// Original: login() only sent phone + password. Users with 2FA enabled saw
// 'alert('2FA code required')' with no way to enter the code — locked out
// of the mobile app entirely.
//
// New: after the first login attempt fails with TWO_FACTOR_REQUIRED, show
// a 2FA code input. The user enters the 6-digit code and submits again —
// login() then sends phone + password + code together.
//
// (INC-06 — migrated from auth.ts plain `login()` to the Zustand store so
// there is one source of truth for auth state.)
export default function LoginScreen() {
  const login = useAuthStore(s => s.login);
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
      // Pass code only if the 2FA input is shown.
      const user = await login(phone, password, needs2FA ? code : undefined);
      if (user.role === 'rider') router.replace('/rider/dashboard');
      else if (user.role === 'contractor') router.replace('/contractor/dashboard');
      else if (user.role === 'corporate_admin') router.replace('/rider/dashboard');
      else if (user.role === 'platform_admin') router.replace('/rider/dashboard');
      else router.replace('/rider/dashboard');
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      // Detect 2FA-required and reveal the code input.
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
        {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
        <Text style={styles.forgotText}>Forgot password?</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.surface },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, textAlign: 'center', marginBottom: spacing.xl, color: colors.text },
  input: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.borderSubtle },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  buttonText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  error: { color: colors.error, textAlign: 'center', marginBottom: spacing.sm, fontSize: fontSize.sm },
  forgotLink: { alignItems: 'center', marginTop: spacing.md },
  forgotText: { color: colors.primary, fontSize: fontSize.sm },
});
