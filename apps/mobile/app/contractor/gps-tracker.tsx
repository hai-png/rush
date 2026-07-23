import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { api } from '../../src/lib/api';

// real GPS tracking using expo-location.
// — riders tracking their shuttle saw nonsense. Now uses actual device GPS.
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

      // Start watching position.
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
      // expo-location not installed — fall back to manual posting with error.
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
      await api.post('/shuttle-positions', pos);
      setLastPosted(new Date().toLocaleTimeString());
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
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16 },
  label: { fontSize: 16, marginBottom: 4 },
  error: { color: '#dc2626', fontSize: 14, marginTop: 4 },
  hint: { fontSize: 12, color: '#999', marginTop: 8 },
  button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
