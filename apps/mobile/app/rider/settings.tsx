import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { logout } from '../../src/lib/auth';
import * as AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);

  async function signOut() {
    await logout();
    router.replace('/auth/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Push notifications</Text>
          <Switch value={notifEnabled} onValueChange={setNotifEnabled} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email notifications</Text>
          <Switch value={emailEnabled} onValueChange={setEmailEnabled} />
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.link} onPress={() => router.push('/rider/subscriptions')}>
          <Text style={styles.linkText}>My Subscriptions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => router.push('/rider/payments')}>
          <Text style={styles.linkText}>Payment History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => router.push('/rider/rides')}>
          <Text style={styles.linkText}>Ride History</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  section: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { fontSize: 16 },
  link: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  linkText: { fontSize: 16, color: '#2563eb' },
  signOut: { backgroundColor: '#fee2e2', borderRadius: 8, padding: 14, alignItems: 'center' },
  signOutText: { color: '#dc2626', fontSize: 16, fontWeight: '600' },
});
