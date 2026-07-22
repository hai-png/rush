import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Picker, Alert } from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';

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
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
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
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Ticket</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 4, marginTop: 12 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  pickerWrap: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  picker: { height: 44 },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
