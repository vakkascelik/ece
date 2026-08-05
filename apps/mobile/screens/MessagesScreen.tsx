import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listMessages, listThreads, markThreadRead, sendMessage, type Message, type MessageThread } from '@ece/api';
import { color, font, radius, space, target, theme } from '../theme';
import { useSession } from '../state/SessionProvider';
import { supabase } from '../lib/supabase';

/**
 * Threads, and one thread at a time.
 *
 * WHY MESSAGES ARE NOT QUEUED OFFLINE, WITH A HARD REASON
 *
 * `sendMessage` inserts with **no `client_uuid`** — there is no idempotency key. The outbox works
 * precisely because attendance events carry one, so a retry whose response was lost is a no-op.
 * A queued message retried the same way would double-post to a family. So messages need
 * connectivity, and the failure has to be visible rather than absorbed.
 *
 * ON FAILURE THE TEXT STAYS IN THE BOX AND NOTHING IS APPENDED
 *
 * No greyed-out "failed" bubble. `messages` is append-only in Postgres and an unsent message does
 * not exist there — a transcript showing something the record does not contain is a lie about the
 * record, on the screen a parent would scroll back through to prove they told the centre about an
 * allergy. Keeping the words in the composer loses nothing and claims nothing.
 *
 * The thread list does not preview messages. The web page reads every thread's messages to render
 * previews, which is 1+N queries; there is no room for a preview on a phone anyway, so this reads
 * `listThreads` alone and loads a thread when one is opened.
 */
export function MessagesScreen() {
  const { activeCentre, session, online } = useSession();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [openThread, setOpenThread] = useState<MessageThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadThreads = useCallback(async () => {
    if (!activeCentre) return;
    try {
      setThreads(await listThreads(supabase, activeCentre));
    } catch {
      // The list on screen is the last one fetched. Nothing to say that the offline banner is not
      // already saying.
    }
  }, [activeCentre]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const open = useCallback(async (thread: MessageThread) => {
    setOpenThread(thread);
    setSendError(null);
    try {
      setMessages(await listMessages(supabase, thread.id));
      // Marks the *other* side's messages read; the policy refuses your own.
      await markThreadRead(supabase, thread.id);
    } catch {
      setMessages([]);
    }
  }, []);

  const send = useCallback(async () => {
    if (!openThread || draft.trim().length === 0) return;
    setBusy(true);
    setSendError(null);
    try {
      await sendMessage(supabase, openThread.id, draft);
      // Cleared only after the server has it. Optimistic append would put a message in the
      // transcript that the append-only table does not contain.
      setDraft('');
      setMessages(await listMessages(supabase, openThread.id));
    } catch {
      setSendError('Not sent — check the connection and try again. Your message is still here.');
    } finally {
      setBusy(false);
    }
  }, [openThread, draft]);

  if (openThread) {
    return (
      <KeyboardAvoidingView
        style={theme.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={theme.content}>
          <Pressable onPress={() => setOpenThread(null)} accessibilityRole="button" accessibilityLabel="Back to messages">
            <Text style={styles.back}>‹ Messages</Text>
          </Pressable>
          <Text style={theme.h2}>{openThread.subject}</Text>
        </View>

        <FlatList
          contentContainerStyle={{ paddingHorizontal: space['4'] }}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => {
            const mine = item.authorId === session?.userId;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                <Text style={theme.body}>{item.body}</Text>
              </View>
            );
          }}
        />

        <View style={styles.composer}>
          {!online && (
            <Text style={[theme.muted, styles.hint]}>
              You are offline. Messages send once you are connected.
            </Text>
          )}
          {sendError && (
            <Text style={theme.error} accessibilityRole="alert">
              {sendError}
            </Text>
          )}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              multiline
              editable={!busy}
              accessibilityLabel="Message"
            />
            {/* Enabled while offline on purpose: attempting is the connectivity check, which is
                the same doctrine the outbox uses. A disabled button teaches people to give up. */}
            <Pressable
              style={[styles.send, (busy || draft.trim().length === 0) && styles.sendOff]}
              onPress={() => void send()}
              disabled={busy || draft.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <FlatList
      style={theme.screen}
      contentContainerStyle={theme.content}
      data={threads}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={<Text style={theme.h1}>Messages</Text>}
      ListEmptyComponent={
        <Text style={theme.muted}>
          No messages yet. A kaiako or a parent can start a conversation on the web app.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.thread}
          onPress={() => void open(item)}
          accessibilityRole="button"
          accessibilityLabel={`Open: ${item.subject}`}
        >
          <Text style={styles.subject}>{item.subject}</Text>
          {item.closedAt && <Text style={theme.muted}>Closed</Text>}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  back: { color: color.accent, fontSize: font.size.mobileBase, marginBottom: space['2'] },
  thread: {
    minHeight: target.comfortable,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingVertical: space['3'],
  },
  subject: { fontSize: font.size.mobileBase, fontWeight: '600', color: color.ink },
  bubble: { borderRadius: radius.md, padding: space['3'], marginBottom: space['2'], maxWidth: '85%' },
  mine: { alignSelf: 'flex-end', backgroundColor: color.accentSoft },
  theirs: { alignSelf: 'flex-start', backgroundColor: color.surfaceSunken },
  composer: { padding: space['3'], borderTopWidth: 1, borderTopColor: color.line },
  composerRow: { flexDirection: 'row', gap: space['2'], alignItems: 'flex-end' },
  hint: { fontSize: font.size.sm, marginBottom: space['2'] },
  input: {
    flex: 1,
    minHeight: target.min,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space['3'],
    paddingTop: space['2'],
    fontSize: font.size.mobileBase,
    color: color.ink,
    backgroundColor: color.surface,
  },
  send: {
    minHeight: target.comfortable,
    paddingHorizontal: space['4'],
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.5 },
  sendText: { color: color.inkInverse, fontWeight: '600', fontSize: font.size.mobileBase },
});
