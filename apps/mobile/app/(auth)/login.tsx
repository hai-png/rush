import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

type Stage = 'credentials' | 'twoFa' | 'locked';

export default function LoginScreen() {
  const [phone, setPhone] = useState('+251');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('credentials');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);

  const submitCredentials = async () => {
    setLoading(true); setError(null);
    const res = await api.POST('/api/v1/auth/token', { body: { phone, password } }) as any;
    setLoading(false);
    if (res.error) {
      const errCode = res.error?.error?.code ?? res.error?.code;
      const status = res.response?.status;
      if (status === 423 || errCode === 'ACCOUNT_LOCKED') {
        setStage('locked');
        return;
      }
      if (errCode === 'TWO_FA_REQUIRED') {
        setStage('twoFa');
        setError(null);
        return;
      }
      setError('Invalid phone number or password');
      return;
    }
    await setAuth(res.data.accessToken, res.data.user.role);
    router.replace('/(rider)/dashboard');
  };

  const submitTwoFa = async () => {
    setLoading(true); setError(null);
    const res = await api.POST('/api/v1/auth/token', { body: { phone, password, code: code.trim() } }) as any;
    setLoading(false);
    if (res.error) {
      const errCode = res.error?.error?.code ?? res.error?.code;
      const status = res.response?.status;
      if (status === 423 || errCode === 'ACCOUNT_LOCKED') {
        setStage('locked');
        return;
      }

      setError('Incorrect code — please try again.');
      return;
    }
    await setAuth(res.data.accessToken, res.data.user.role);
    router.replace('/(rider)/dashboard');
  };

  if (stage === 'locked') {
    return (
      <View className="flex-1 justify-center px-6 bg-background">
        <Text className="text-2xl font-semibold text-center mb-4 text-foreground">Account locked</Text>
        <Text className="text-sm text-muted-foreground text-center mb-8">
          For your security, your account has been temporarily locked after too many failed sign-in attempts. Please try again later or contact support.
        </Text>
        <Pressable
          onPress={() => {
            setStage('credentials');
            setPassword('');
            setCode('');
            setError(null);
          }}
          className="h-12 rounded-xl bg-foreground items-center justify-center"
        >
          <Text className="text-background font-medium">Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center px-6 bg-background">
      <Text className="text-2xl font-semibold text-center mb-8 text-foreground">
        {stage === 'twoFa' ? 'Enter verification code' : 'Welcome back'}
      </Text>

      {stage === 'credentials' && (
        <>
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
        </>
      )}

      {stage === 'twoFa' && (
        <>
          <Text className="text-sm text-muted-foreground text-center mb-6">
            We sent a 6-digit code to your authenticator app. Enter it below to continue.
          </Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            className="h-14 rounded-xl border border-border px-3 mb-2 text-center text-xl tracking-widest text-foreground"
            accessibilityLabel="Two-factor authentication code"
            autoFocus
          />
        </>
      )}

      {error && <Text className="text-destructive text-sm mb-2">{error}</Text>}

      <Pressable
        onPress={stage === 'twoFa' ? submitTwoFa : submitCredentials}
        disabled={loading || (stage === 'twoFa' && code.length !== 6)}
        className="h-12 rounded-xl bg-foreground items-center justify-center mt-4"
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-background font-medium">{stage === 'twoFa' ? 'Verify' : 'Log in'}</Text>}
      </Pressable>

      {stage === 'twoFa' && (
        <Pressable
          onPress={() => { setStage('credentials'); setCode(''); setError(null); }}
          className="mt-4"
        >
          <Text className="text-center text-accent text-sm">Use a different account</Text>
        </Pressable>
      )}

      {stage === 'credentials' && (
        <Pressable onPress={() => router.push('/(auth)/signup')} className="mt-4">
          <Text className="text-center text-accent text-sm">Create an account</Text>
        </Pressable>
      )}
    </View>
  );
}
