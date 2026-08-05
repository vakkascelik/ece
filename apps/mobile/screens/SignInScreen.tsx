import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { color, font, radius, space, target, theme } from '../theme';
import { useSession } from '../state/SessionProvider';

/**
 * Sign in. The screen whose absence meant this app could not be used by anybody who installed
 * it — `App.tsx` rendered the words "Not signed in." and offered nothing.
 *
 * TWO FIELDS AND NO THIRD AFFORDANCE
 *
 * No "create account": the Supabase project has `disable_signup: true`, and an account is how
 * somebody reaches children's records. Accounts come from a centre inviting a person, and
 * acceptance needs the service-role key and `node:crypto` — neither of which can exist in this
 * bundle — so it happens in a browser and cannot be moved here.
 *
 * No "forgot password" **button**, but the thing itself now exists — on the web app, at
 * /forgot-password. Until 2026-08-05 this comment said the link "would go nowhere" because no
 * mailer was configured; that is no longer true. What has not changed is that the recovery link
 * establishes a session in a browser and sets a password there, so a button here would be a
 * button that leaves the app. The footnote says where to go instead.
 *
 * What replaces both is one honest sentence about where access comes from. A dead end with no
 * explanation is a support call; a dead end with a reason is a person emailing their manager.
 *
 * ONE ERROR MESSAGE
 *
 * The provider returns `'Those details are not right.'` for every failure. That is deliberate
 * and load-bearing: distinguishing an unknown address from a wrong password turns this form into
 * a way to enumerate who works at a named childcare centre, one guess at a time. See the comment
 * in `SessionProvider.signIn`.
 */
export function SignInScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      if (result) setError(result.error);
      // On success the provider updates the session and the navigator swaps this screen out.
      // Nothing to navigate to from here, deliberately — one place decides what is on screen.
    } catch {
      // A network failure is not "those details are not right", and saying so would send
      // somebody to reset a password that was correct.
      setError('Could not reach the centre. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={theme.screen}
      // The submit button sits below both fields, so on a small phone with the keyboard up it is
      // off screen without this.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[theme.content, styles.centre]} keyboardShouldPersistTaps="handled">
        {/* 36/600 — the pack's mobile display size, against 28 on web. This is read at
            arm's length and it is the first thing on the screen. */}
        <Text style={styles.nauMai}>Nau mai</Text>
        <Text style={[styles.sub]}>Sign in to your centre.</Text>

        <View style={styles.field}>
          <Text style={styles.label} nativeID="email-label">
            Email
          </Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            // Every one of these matters on a phone: autocorrect turning an address into a word,
            // a capital from the keyboard's default shift, or the wrong keyboard entirely.
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="next"
            editable={!busy}
            accessibilityLabelledBy="email-label"
            accessibilityLabel="Email"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label} nativeID="password-label">
            Password
          </Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
            accessibilityLabelledBy="password-label"
            accessibilityLabel="Password"
          />
        </View>

        {error && (
          // A tinted block, not red text on the page background. The pack asks for it and the
          // reason is the room: this is read standing up, often in poor light, and a colour
          // change on a thin glyph of text is the first thing to disappear. The block also
          // holds a 17/500 line rather than the 15 used elsewhere.
          //
          // `alert` so it is announced when it appears — a sighted user sees the block, and
          // without this a screen reader user taps a button and is told nothing.
          <View style={styles.errorBlock} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonOff]}
          onPress={() => void submit()}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: !canSubmit, busy }}
        >
          {busy ? (
            <ActivityIndicator color={color.inkInverse} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>

        {/*
          The pack's footnote ends "and no password reset — ask your centre to send a new
          invitation". Reset exists now, and a re-invitation still cannot recover a password for
          an address that already has an account, so repeating that sentence would send somebody
          down a path that does not work. Same deviation as the web login screen.
        */}
        <Text style={styles.help}>
          Your centre invites you; there is no sign-up here. The invitation, and setting a new
          password if you have forgotten yours, both open in a browser.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centre: { flexGrow: 1, justifyContent: 'center' },
  nauMai: {
    fontSize: font.size['3xl'],
    fontWeight: font.weight.semibold,
    color: color.ink,
    marginBottom: space['1'],
  },
  // 17, not the 15 `theme.muted` uses. Mobile body is 17 throughout the pack.
  sub: { fontSize: font.size.mobileBase, color: color.inkMuted, marginBottom: space['6'] },
  field: { marginBottom: space['4'] },
  label: { fontSize: font.size.sm, color: color.inkMuted, marginBottom: space['1'] },
  input: {
    // `target.comfortable`, not `min`: this is typed on, standing up, one-handed.
    minHeight: target.comfortable,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space['3'],
    fontSize: font.size.mobileBase,
    color: color.ink,
    backgroundColor: color.surface,
  },
  errorBlock: {
    backgroundColor: color.breachSoft,
    borderRadius: radius.md,
    paddingVertical: space['3'],
    paddingHorizontal: space['4'],
    marginBottom: space['3'],
  },
  errorText: {
    fontSize: font.size.mobileBase,
    fontWeight: font.weight.medium,
    color: color.breach,
  },
  button: {
    minHeight: target.primary,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space['2'],
  },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: color.inkInverse, fontSize: font.size.mobileBase, fontWeight: '600' },
  help: { marginTop: space['6'], fontSize: font.size.base, color: color.inkMuted, lineHeight: 22 },
});
