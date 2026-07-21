import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import { api } from '../../src/lib/api';

export default function GpsTrackerScreen() {
  const [posting, setPosting] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function postPosition() {
    setPosting(true); setError('');
    try {
      // In a real app, use expo-location to get actual GPS coords.
      // For now, use Addis Ababa center as placeholder.
      const lat = 9.03 + (Math.random() - 0.5) * 0.02;
      const lng = 38.74 + (Math.random() - 0.5) * 0.02;
      await api.post('/shuttle-positions', { lat, lng, heading: Math.floor(Math.random() * 360), speed: Math.floor(Math.random() * 60) });
      setLastPosted(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post position');
    } finally { setPosting(false); }
  }

  useEffect(() => {
    const interval = setInterval(postPosition, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GPS Tracker</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Status: {posting ? 'Posting…' : 'Idle'}</Text>
        {lastPosted && <Text style={styles.label}>Last posted: {lastPosted}</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>Auto-posts every 10 seconds while on this screen</Text>
        <TouchableOpacity style={styles.button} onPress={postPosition} disabled={posting}>
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
