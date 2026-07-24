import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/lib/auth-store';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';
import { routeByRole } from '../../src/lib/route-by-role';

// Mobile login: after a TWO_FACTOR_REQUIRED response, prompt for a 6-digit
// code and resubmit phone + password + code together.
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
      // H-29 fix: route by role via shared helper
      router.replace(routeByRole(user.role));
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
