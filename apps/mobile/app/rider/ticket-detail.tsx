import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (id) {
      api.get(`/tickets/${id}`).then(d => { setTicket(d); setMessages(d?.messages || []); }).catch(() => {});
    }
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
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  subject: { fontSize: 16, fontWeight: 'bold' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  msgList: { flex: 1, padding: 16 },
  msg: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8 },
  msgAdmin: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1 },
  msgAuthor: { fontSize: 12, fontWeight: '600', color: '#2563eb' },
  msgBody: { fontSize: 14, marginTop: 4 },
  msgTime: { fontSize: 10, color: '#999', marginTop: 4 },
  replyBox: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  replyInput: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, maxHeight: 80, fontSize: 14 },
  sendBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 },
  sendText: { color: '#fff', fontWeight: '600' },
});
