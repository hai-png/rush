import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/lib/auth-store';
import { getSettings, saveSettings, getBiometricsEnabled, setBiometricsEnabled as persistBiometrics } from '../../src/lib/settings-store';
import { registerForPushNotifications } from '../../src/lib/push';
import { api } from '../../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function SettingsScreen() {
  const logout = useAuthStore(s => s.logout);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);

  useEffect(() => {
    let active = true;
    getSettings().then(s => {
      if (!active) return;
      setNotifEnabled(s.notificationEnabled);
      setEmailEnabled(s.emailEnabled);
      setBiometricsEnabledState(s.biometricsEnabled);
    });
    return () => { active = false; };
  }, []);

  async function toggleBiometrics(value: boolean) {
    if (value) {
      // Verify biometrics are available before enabling.
      try {
        const LocalAuth = require('expo-local-authentication');
        const hasHardware = await LocalAuth.hasHardwareAsync();
        const enrolled = await LocalAuth.isEnrolledAsync();
        if (!hasHardware || !enrolled) {
          Alert.alert('Not available', 'Biometric authentication is not available or not set up on this device.');
          return;
        }
      } catch {
        Alert.alert('Not available', 'Biometric authentication module not installed.');
        return;
      }
    }
    await persistBiometrics(value);
    setBiometricsEnabledState(value);
  }

  async function toggleNotifications(value: boolean) {
    setNotifEnabled(value);
    try { await api.patch('/notifications/preferences', { notificationEnabled: value }); } catch {}
    await saveSettings({ notificationEnabled: value });
    if (value) {
      registerForPushNotifications().catch(() => {});
    }
  }

  async function toggleEmail(value: boolean) {
    setEmailEnabled(value);
    try { await api.patch('/notifications/preferences', { emailEnabled: value }); } catch {}
    await saveSettings({ emailEnabled: value });
  }

  async function signOut() {
    await logout();
    router.replace('/auth/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Biometric unlock</Text>
          <Switch value={biometricsEnabled} onValueChange={toggleBiometrics} trackColor={{ false: colors.border, true: colors.primary }} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Push notifications</Text>
          <Switch value={notifEnabled} onValueChange={toggleNotifications} trackColor={{ false: colors.border, true: colors.primary }} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email notifications</Text>
          <Switch value={emailEnabled} onValueChange={toggleEmail} trackColor={{ false: colors.border, true: colors.primary }} />
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
  container: { flex: 1, backgroundColor: colors.surface, padding: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginBottom: spacing.md, color: colors.text },
  section: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textMuted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  label: { fontSize: fontSize.md, color: colors.text },
  link: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  linkText: { fontSize: fontSize.md, color: colors.primary },
  signOut: { backgroundColor: colors.errorBg, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  signOutText: { color: colors.error, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
