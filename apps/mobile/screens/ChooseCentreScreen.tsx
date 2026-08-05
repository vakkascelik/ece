import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space, target, theme } from '../theme';
import { useSession } from '../state/SessionProvider';

/**
 * Which centre, for somebody who belongs to more than one.
 *
 * DELIBERATELY A SCREEN RATHER THAN A GUESS
 *
 * The same decision the web app records: guessing is how a manager of two sites reads the wrong
 * room's ratio, or signs a child in at the site they are not standing in. Neither is recoverable
 * by noticing later — the ratio was wrong at the moment it mattered, and an attendance event is
 * append-only.
 *
 * It is only reached when there are two or more memberships. One membership auto-selects and this
 * screen never appears, which is the common case and the reason it does not cost the single-site
 * educator a tap.
 *
 * The choice persists (see `activeCentreStore.ts`), so this is a once-per-device screen rather
 * than a once-per-launch one — but it stays reachable from Settings, because a manager moving
 * between sites during a day must be able to switch without signing out.
 */
export function ChooseCentreScreen() {
  const { centres, activeCentre, chooseCentre } = useSession();

  return (
    <ScrollView contentContainerStyle={theme.content}>
      <Text style={theme.h1}>Which centre?</Text>
      <Text style={[theme.muted, styles.sub]}>You have access to more than one.</Text>

      {centres.map((c) => {
        const selected = c.id === activeCentre;
        return (
          <Pressable
            key={c.id}
            style={[styles.option, selected && styles.optionOn]}
            onPress={() => chooseCentre(c.id)}
            accessibilityRole="button"
            // `selected` rather than a tick glyph alone: a screen reader announces the state,
            // and the visual highlight is the same information for everybody else.
            accessibilityState={{ selected }}
            accessibilityLabel={
              c.moeServiceNumber
                ? `${c.name}, Ministry service number ${c.moeServiceNumber}`
                : c.name
            }
          >
            <Text style={[styles.name, selected && styles.nameOn]}>{c.name}</Text>
            {c.moeServiceNumber && (
              <View style={styles.pill}>
                <Text style={styles.pillText}>MoE {c.moeServiceNumber}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: space['5'] },
  option: {
    minHeight: target.comfortable,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingHorizontal: space['4'],
    paddingVertical: space['3'],
    marginBottom: space['3'],
  },
  optionOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  name: { fontSize: font.size.mobileBase, fontWeight: '600', color: color.ink },
  nameOn: { color: color.accentHover },
  pill: {
    alignSelf: 'flex-start',
    marginTop: space['2'],
    paddingHorizontal: space['2'],
    paddingVertical: space['1'],
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSunken,
  },
  pillText: { fontSize: font.size.sm, color: color.inkMuted },
});
