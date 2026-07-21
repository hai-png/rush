import { View, Text, FlatList, StyleSheet } from 'react-native';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

type Notif = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export default function NotificationsScreen() {
  const [notifs, setNotifs] = useState<Notif[]>([]);

  useFocusEffect(useCallback(() => {
    api.get<Notif[]>('/notifications').then(d => setNotifs(d || [])).catch(() => {});
  }, []));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications</Text>
      <FlatList
        data={notifs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.card, !item.readAt && styles.unread]}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
            <Text style={styles.cardTime}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No notifications</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  unread: { borderLeftWidth: 4, borderLeftColor: '#2563eb' },
  cardTitle: { fontSize: 14, fontWeight: '600' },
  cardBody: { fontSize: 13, color: '#666', marginTop: 4 },
  cardTime: { fontSize: 11, color: '#999', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
