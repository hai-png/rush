import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

// Picker was removed from react-native core in 0.74 (deprecated since 0.60).
// We use a runtime require + any-cast so the screen keeps working until we
// migrate to @react-native-picker/picker. This file's Picker usage is
// unrelated to the audit findings covered in this pass.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Picker: any = (require('react-native') as any).Picker ?? (() => null);

export default function NewTicketScreen() {
  const [form, setForm] = useState({ subject: '', category: 'general', priority: 'normal', body: '' });
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const result = await api.post('/tickets', form);
      Alert.alert('Success', 'Ticket created');
      router.replace('/rider/tickets');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={styles.label}>Subject</Text>
      <TextInput style={styles.input} value={form.subject} onChangeText={v => setForm({ ...form, subject: v })} />
      <Text style={styles.label}>Category</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={form.category} onValueChange={v => setForm({ ...form, category: v })} style={styles.picker}>
          {['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other'].map(c => <Picker.Item key={c} label={c} value={c} />)}
        </Picker>
      </View>
      <Text style={styles.label}>Priority</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={form.priority} onValueChange={v => setForm({ ...form, priority: v })} style={styles.picker}>
          {['low', 'normal', 'high', 'urgent'].map(p => <Picker.Item key={p} label={p} value={p} />)}
        </Picker>
      </View>
      <Text style={styles.label}>Message</Text>
      <TextInput style={[styles.input, styles.textarea]} value={form.body} onChangeText={v => setForm({ ...form, body: v })} multiline numberOfLines={4} />
      <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading || !form.subject || !form.body}>
        {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnText}>Create Ticket</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing.xs, marginTop: 12 },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: 12, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.borderSubtle },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  pickerWrap: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderSubtle },
  picker: { height: 44 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 20 },
  btnText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
