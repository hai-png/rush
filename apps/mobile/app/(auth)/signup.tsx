import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';

const STEPS = ['Account', 'Commute', 'Review'];

export default function SignupScreen() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '+251', password: '', homeArea: '', workArea: '', tosAccepted: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true); setError(null);
    const { error: apiError } = await api.POST('/api/v1/auth/register', {
      body: { kind: 'rider', name: form.name, phone: form.phone, password: form.password, homeArea: form.homeArea, workArea: form.workArea },
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
          onPress={() => (step < 2 ? setStep((s) => s + 1) : submit())}
          disabled={step === 2 && (!form.tosAccepted || loading)}
          className="flex-1 h-12 rounded-xl bg-foreground items-center justify-center disabled:opacity-40"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-background font-medium">{step < 2 ? 'Continue' : 'Create account'}</Text>}
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
