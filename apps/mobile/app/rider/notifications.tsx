import { View, Text, FlatList, StyleSheet } from 'react-native';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

type Notif = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export default function NotificationsScreen() {
  const [notifs, setNotifs] = useState<Notif[]>([]);

  useFocusEffect(useCallback(() => {
    let active = true;
    api.get<Notif[]>('/notifications')
      .then(d => { if (active) setNotifs(d || []); })
      .catch(() => { if (active) setNotifs([]); });
    return () => { active = false; };
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
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  cardBody: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  cardTime: { fontSize: 11, color: colors.textLight, marginTop: spacing.xs },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
});
