import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    api.get(`/tickets/${id}`)
      .then(d => {
        if (!active) return;
        setTicket(d);
        setMessages(d?.messages || []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [id]);

  async function sendReply() {
    if (!reply.trim() || !id) return;
    setLoading(true);
    try {
      const msg = await api.post(`/tickets/${id}/messages`, { body: reply });
      setMessages([...messages, msg]);
      setReply('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setLoading(false);
  }

  if (!ticket) return <View style={styles.center}><Text>Loading…</Text></View>;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.subject}>{ticket.subject}</Text>
        <Text style={styles.sub}>{ticket.category} · {ticket.priority} · {ticket.status}</Text>
      </View>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={[styles.msg, item.author?.role === 'platform_admin' && styles.msgAdmin]}>
            <Text style={styles.msgAuthor}>{item.author?.name} · {item.author?.role}</Text>
            <Text style={styles.msgBody}>{item.body}</Text>
            <Text style={styles.msgTime}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        )}
        style={styles.msgList}
      />
      {ticket.status !== 'closed' && (
        <View style={styles.replyBox}>
          <TextInput style={styles.replyInput} value={reply} onChangeText={setReply} placeholder="Type a reply…" multiline />
          <TouchableOpacity style={styles.sendBtn} onPress={sendReply} disabled={loading || !reply.trim()}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, backgroundColor: colors.card },
  subject: { fontSize: fontSize.md, fontWeight: fontWeight.bold },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  msgList: { flex: 1, padding: spacing.md },
  msg: { backgroundColor: colors.card, borderRadius: radius.md, padding: 12, marginBottom: spacing.sm },
  msgAdmin: { backgroundColor: colors.infoBg, borderColor: colors.infoBorder, borderWidth: 1 },
  msgAuthor: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
  msgBody: { fontSize: fontSize.sm, marginTop: spacing.xs },
  msgTime: { fontSize: 10, color: colors.textLight, marginTop: spacing.xs },
  replyBox: { flexDirection: 'row', padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  replyInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: 10, maxHeight: 80, fontSize: fontSize.sm },
  sendBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', marginLeft: spacing.sm },
  sendText: { color: colors.white, fontWeight: fontWeight.semibold },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
