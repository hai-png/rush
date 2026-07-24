import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { api } from '../../src/lib/api';
import { queueOrSend } from '../../src/lib/offline-queue';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

// Contractor GPS tracker — posts device GPS coordinates to /shuttle-positions
// every 10s while the screen is foregrounded (requires foreground location
// permission).
export default function GpsTrackerScreen() {
  const [posting, setPosting] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number; heading: number; speed: number } | null>(null);
  const subscriptionRef = useRef<any>(null);

  useEffect(() => {
    requestPermissionAndStart();
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, []);

  async function requestPermissionAndStart() {
    try {
      const Location = require('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);
      if (status !== 'granted') {
        setError('Location permission denied — riders cannot track your shuttle.');
        return;
      }

      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000, // 10s
          distanceInterval: 10, // 10m
        },
        (location: any) => {
          const coords = {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            heading: location.coords.heading ?? 0,
            speed: Math.round((location.coords.speed ?? 0) * 3.6), // m/s → km/h
          };
          setCurrentCoords(coords);
          postPosition(coords);
        },
      );
    } catch (e) {
      // expo-location missing or permission denied — fall back to manual posting.
      setError('GPS not available: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function postPosition(coords?: { lat: number; lng: number; heading: number; speed: number }) {
    setPosting(true); setError('');
    try {
      const pos = coords ?? currentCoords;
      if (!pos) {
        setError('No GPS coordinates available yet');
        return;
      }
      // H-33 fix: use the offline queue instead of api.post directly.
      // On network failure, the position is queued locally and retried.
      // Previously, a dropped connection meant the position was lost forever
      // and riders tracking the shuttle saw a stale map.
      const result = await queueOrSend('POST', '/shuttle-positions', pos);
      setLastPosted(new Date().toLocaleTimeString());
      if (result.queued) {
        setError('Saved offline — will sync when connection returns');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post position');
    } finally { setPosting(false); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GPS Tracker</Text>
      <View style={styles.card}>
        <Text style={styles.label}>GPS Permission: {permissionStatus ?? 'checking…'}</Text>
        {currentCoords && (
          <Text style={styles.label}>
            Current: {currentCoords.lat.toFixed(4)}, {currentCoords.lng.toFixed(4)}
            {currentCoords.speed > 0 ? ` · ${currentCoords.speed} km/h` : ''}
          </Text>
        )}
        <Text style={styles.label}>Status: {posting ? 'Posting…' : 'Idle'}</Text>
        {lastPosted && <Text style={styles.label}>Last posted: {lastPosted}</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>
          Auto-posts every 10 seconds while on this screen (requires foreground location permission).
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => postPosition()} disabled={posting || !currentCoords}>
          <Text style={styles.buttonText}>Post position now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, padding: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginBottom: spacing.md, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md },
  label: { fontSize: fontSize.md, marginBottom: spacing.xs, color: colors.text },
  error: { color: colors.error, fontSize: fontSize.sm, marginTop: spacing.xs },
  hint: { fontSize: fontSize.xs, color: colors.textLight, marginTop: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 12 },
  buttonText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
