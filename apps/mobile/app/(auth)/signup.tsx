import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';

const STEPS = ['Account', 'Commute', 'Verify', 'Review'];

export default function SignupScreen() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '+251', password: '', homeArea: '', workArea: '', otp: '', tosAccepted: false });
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = async () => {
    setError(null);
    setSendingOtp(true);
    const { error: apiError } = await api.POST('/api/v1/auth/otp/send', { body: { phone: form.phone, purpose: 'signup_verification' } });
    setSendingOtp(false);
    if (apiError) { setError('Could not send code. Try again.'); }
  };

  const submit = async () => {
    setLoading(true); setError(null);
    // The register endpoint now requires an OTP that was sent via /auth/otp/send with
    // purpose=signup_verification. Without this, the phone number is never actually
    // verified and `phoneVerified` is permanently false on the user row.
    const { error: apiError } = await api.POST('/api/v1/auth/register', {
      body: { kind: 'rider', name: form.name, phone: form.phone, password: form.password, homeArea: form.homeArea, workArea: form.workArea, otp: form.otp },
    });
    setLoading(false);
    if (apiError) { setError('Could not create account. Check your details.'); return; }
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView className="flex-1 bg-background px-6 pt-16">
      <View className="flex-row mb-8">
        {STEPS.map((s, i) => (
          <View key={s} className={`flex-1 h-1 rounded-full mx-1 ${i <= step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </View>

      {step === 0 && (
        <View className="gap-3">
          <Field label="Full name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Field label="Phone number" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" />
          <Field label="Password" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secureTextEntry />
        </View>
      )}
      {step === 1 && (
        <View className="gap-3">
          <Field label="Home area" value={form.homeArea} onChangeText={(v) => setForm((f) => ({ ...f, homeArea: v }))} />
          <Field label="Work area" value={form.workArea} onChangeText={(v) => setForm((f) => ({ ...f, workArea: v }))} />
        </View>
      )}
      {step === 2 && (
        <View className="gap-3">
          <Text className="text-sm text-muted-foreground">We sent a 6-digit code to {form.phone}. Enter it below to verify your number.</Text>
          <Pressable
            onPress={sendOtp}
            disabled={sendingOtp}
            className="h-12 rounded-xl border border-border items-center justify-center"
          >
            {sendingOtp ? <ActivityIndicator /> : <Text className="text-foreground">{form.otp ? 'Resend code' : 'Send code'}</Text>}
          </Pressable>
          <Field label="Verification code" value={form.otp} onChangeText={(v) => setForm((f) => ({ ...f, otp: v.replace(/\D/g, '').slice(0, 6) }))} keyboardType="number-pad" maxLength={6} />
          {error && <Text className="text-destructive text-sm">{error}</Text>}
        </View>
      )}
      {step === 3 && (
        <View className="gap-3">
          <View className="bg-secondary rounded-xl p-4">
            <Text className="text-foreground">{form.name} · {form.phone}</Text>
            <Text className="text-muted-foreground text-sm mt-1">{form.homeArea} → {form.workArea}</Text>
          </View>
          <Pressable onPress={() => setForm((f) => ({ ...f, tosAccepted: !f.tosAccepted }))} className="flex-row items-center gap-2">
            <View className={`h-5 w-5 rounded border ${form.tosAccepted ? 'bg-primary border-primary' : 'border-border'}`} />
            <Text className="text-sm text-foreground flex-1">I agree to the Terms of Service and Privacy Policy</Text>
          </Pressable>
          {error && <Text className="text-destructive text-sm">{error}</Text>}
        </View>
      )}

      <View className="flex-row gap-3 mt-8 mb-8">
        {step > 0 && (
          <Pressable onPress={() => setStep((s) => s - 1)} className="flex-1 h-12 rounded-xl border border-border items-center justify-center">
            <Text className="text-foreground">Back</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => (step < 3 ? setStep((s) => s + 1) : submit())}
          disabled={step === 3 && (!form.tosAccepted || loading)}
          className="flex-1 h-12 rounded-xl bg-foreground items-center justify-center disabled:opacity-40"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-background font-medium">{step < 3 ? 'Continue' : 'Create account'}</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Field(props: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View>
      <Text className="text-sm font-medium mb-1 text-foreground">{props.label}</Text>
      <TextInput {...props} className="h-12 rounded-xl border border-border px-3 text-foreground" accessibilityLabel={props.label} />
    </View>
  );
}
