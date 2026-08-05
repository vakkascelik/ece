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
 * No "forgot password": there is no mailer configured on the project, so the link would go
 * nowhere. A dead button is worse than no button, and worse still on the screen somebody has
 * already failed to get past.
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
        <Text style={theme.h1}>Sign in</Text>
        <Text style={[theme.muted, styles.sub]}>ECE</Text>

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
          // `alert` so it is announced when it appears — a sighted user sees the red text, and
          // without this a screen reader user taps a button and is told nothing.
          <Text style={[theme.error, styles.error]} accessibilityRole="alert">
            {error}
          </Text>
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

        <Text style={[theme.muted, styles.help]}>
          Access comes from your centre. If you have not been invited yet, ask your manager — the
          invitation arrives by email and opens in a browser.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centre: { flexGrow: 1, justifyContent: 'center' },
  sub: { marginBottom: space['6'] },
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
  error: { marginBottom: space['3'] },
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
  help: { marginTop: space['6'], fontSize: font.size.sm },
});
