import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { listMyCentres, loadSession } from '@ece/api';
import { activeMemberships, type Centre, type Session } from '@ece/core';
import { supabase } from './lib/supabase';

/**
 * Proof that both apps run off one query layer: this screen calls the same
 * `loadSession` and `listMyCentres` as the web app's landing page. No tenant
 * filter appears in either — Row Level Security decides what comes back.
 */
export default function App() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: Session | null; centres: Centre[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = await loadSession(supabase);
        const centres = session ? await listMyCentres(supabase) : [];
        if (!cancelled) setState({ status: 'ready', session, centres });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    }
    load();

    // Re-read on sign-in and sign-out. Without this the screen keeps showing the
    // previous user's centres until the app is restarted — which on a shared
    // staffroom tablet means showing one educator another's data.
    const { data } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>ECE</Text>

        {state.status === 'loading' && <ActivityIndicator />}

        {state.status === 'error' && <Text style={styles.error}>{state.message}</Text>}

        {state.status === 'ready' && !state.session && <Text style={styles.body}>Not signed in.</Text>}

        {state.status === 'ready' && state.session && (
          <View>
            <Text style={styles.body}>
              {activeMemberships(state.session).length} membership(s)
            </Text>
            {state.centres.length === 0 ? (
              <Text style={styles.muted}>No centres yet — an owner or manager needs to add you.</Text>
            ) : (
              state.centres.map((c) => (
                <Text key={c.id} style={styles.item}>
                  {c.name}
                  {c.moeServiceNumber ? ` · MoE ${c.moeServiceNumber}` : ''}
                </Text>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fafaf9' },
  content: { padding: 24 },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 16, color: '#1a1a1a' },
  body: { fontSize: 16, color: '#1a1a1a', marginBottom: 12 },
  muted: { fontSize: 15, color: '#6b6b6b' },
  item: { fontSize: 16, color: '#1a1a1a', paddingVertical: 6 },
  error: { fontSize: 15, color: '#b5451b' },
});
