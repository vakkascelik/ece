import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space, target, theme } from '../theme';
import { useSession } from '../state/SessionProvider';
import { flush, pending } from '../lib/outbox';
import { supabase } from '../lib/supabase';

/**
 * Who you are, which centre you are looking at, how to leave, and how to ask about your data.
 *
 * THE LAST SECTION IS A STORE REQUIREMENT AND ALSO THE TRUTH
 *
 * Apple requires apps that support account creation to offer in-app account deletion. This app
 * cannot create an account — invitations are accepted in a browser, and account creation needs the
 * service-role key — so the rule arguably does not apply. Reviewers apply it anyway often enough
 * that arguing is the wrong plan, and Google separately requires a reachable deletion-request URL.
 *
 * What is actually possible from a client holding only the anon key: nothing. A user cannot revoke
 * their own membership (the policy on `memberships` restricts UPDATE to owners and managers) and
 * cannot delete their own `auth.users` row (that needs the admin API). So a "delete my account"
 * button here would be a button that silently does nothing, which is worse than no button.
 *
 * Instead this says what is true: the login is yours, the records belong to the centre, deleting
 * one does not delete the other, and here is where to ask. New Zealand law is the reason for the
 * distinction — IPP 6 and 7 give access and correction, IPP 9 obliges the centre to a retention
 * schedule, and there is no right to erasure to point at.
 */

/** Set at build time; the deployed web app hosts the public pages. */
const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '';

export function SettingsScreen() {
  const { session, centre, centres, role, chooseCentre, signOut } = useSession();
  const [busy, setBusy] = useState(false);

  const openDataRequests = useCallback(async () => {
    if (!WEB_ORIGIN) {
      Alert.alert(
        'Ask your centre',
        'Your centre holds your records and can answer requests about access, correction or deletion. Their privacy officer is the person to contact.',
      );
      return;
    }
    await Linking.openURL(`${WEB_ORIGIN}/data-requests`);
  }, []);

  const attemptSignOut = useCallback(async () => {
    setBusy(true);
    try {
      const result = await signOut();
      if (!result) return;

      /*
       * Refused because the outbox still holds sign-ins that never reached the centre. Signing out
       * clears the queue, so proceeding would discard the only record that those children are in
       * the building. Offer to send them first; only allow discarding on an explicit second
       * decision, with the count named.
       */
      Alert.alert('Not yet', result.blocked, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Try sending now',
          onPress: () => {
            void (async () => {
              await flush(supabase).catch(() => {});
              const left = (await pending()).filter((e) => !e.deadAt).length;
              if (left === 0) await signOut();
              else
                Alert.alert(
                  'Still holding records',
                  `${left} could not be sent. Ask a manager to record them by hand before signing out.`,
                );
            })();
          },
        },
        {
          text: 'Sign out and discard',
          style: 'destructive',
          onPress: () => void signOut({ force: true }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [signOut]);

  return (
    <ScrollView style={theme.screen} contentContainerStyle={theme.content}>
      <Text style={theme.h1}>Settings</Text>

      <View style={styles.block}>
        <Text style={theme.h2}>You</Text>
        <Text style={theme.body}>{session?.userId ? 'Signed in' : 'Not signed in'}</Text>
        {role && <Text style={theme.muted}>Your role here: {role}</Text>}
      </View>

      <View style={styles.block}>
        <Text style={theme.h2}>Centre</Text>
        <Text style={theme.body}>{centre?.name ?? 'None chosen'}</Text>
        {centre?.moeServiceNumber && (
          <Text style={theme.muted}>Ministry service number {centre.moeServiceNumber}</Text>
        )}

        {/* Switching without signing out, because a manager moves between sites during a day. */}
        {centres.length > 1 &&
          centres
            .filter((c) => c.id !== centre?.id)
            .map((c) => (
              <Pressable
                key={c.id}
                style={styles.secondary}
                onPress={() => chooseCentre(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${c.name}`}
              >
                <Text style={styles.secondaryText}>Switch to {c.name}</Text>
              </Pressable>
            ))}
      </View>

      <View style={styles.block}>
        <Text style={theme.h2}>Your account and your data</Text>
        <Text style={theme.body}>
          Your login belongs to you. The records about your child belong to the centre, which is
          responsible for them under the Privacy Act.
        </Text>
        <Text style={[theme.muted, styles.para]}>
          You can ask to see what is held and to have it corrected. Removing your login does not
          remove your child&rsquo;s enrolment record — the centre has to keep that for its
          retention period, even after your child leaves.
        </Text>
        <Pressable
          style={styles.secondary}
          onPress={() => void openDataRequests()}
          accessibilityRole="button"
          accessibilityLabel="Ask about your data"
        >
          <Text style={styles.secondaryText}>Ask about your data</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.danger}
        onPress={() => void attemptSignOut()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Sign out of this app"
        accessibilityState={{ disabled: busy }}
      >
        {/* "Sign out of this app", not "Sign out" — on this product "sign out" means a child
            leaving, and the button that ends a session must not read like the button that ends a
            child's day. */}
        <Text style={styles.dangerText}>Sign out of this app</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space['5'] },
  para: { marginTop: space['2'] },
  secondary: {
    minHeight: target.comfortable,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space['4'],
    marginTop: space['3'],
  },
  secondaryText: { color: color.ink, fontSize: font.size.mobileBase, fontWeight: '600' },
  danger: {
    minHeight: target.comfortable,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.breachBorder,
    backgroundColor: color.breachSoft,
    borderRadius: radius.md,
    marginTop: space['8'],
  },
  dangerText: { color: color.breach, fontSize: font.size.mobileBase, fontWeight: '600' },
});
