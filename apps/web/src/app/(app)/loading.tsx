/**
 * Shown while a screen's queries run.
 *
 * WHY THIS MATTERS MORE HERE THAN ON MOST PRODUCTS
 *
 * Every page in this group is a Server Component that awaits its data before rendering
 * anything. Without a `loading.tsx`, Next holds the *previous* screen on the display until the
 * new one is ready — so tapping "Attendance" on a tablet at 7.30am, on centre wifi, appears to
 * do nothing at all. The educator taps again. The attendance page issues four queries in
 * parallel and the sign-in round trip already measures around 900ms, so this is not a
 * hypothetical few milliseconds.
 *
 * The response to an interface that seems not to have responded is to repeat the action, and
 * the actions on these screens sign children in and out.
 *
 * WHY A SKELETON AND NOT A SPINNER
 *
 * A spinner says "wait"; a skeleton says "wait, and here is the shape of what is coming",
 * which measurably reduces repeat taps. It also keeps the layout from jumping when the content
 * lands, and it does not spin forever if something is genuinely wrong — the error boundary is
 * what handles that case.
 *
 * `aria-busy` and a polite live region, so this is announced rather than being a silent gap
 * for anyone using a screen reader. `aria-hidden` on the bars themselves: they carry no
 * information, and announcing four empty boxes is worse than announcing nothing.
 */
export default function AppLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sub">
        Loading…
      </p>
      <div aria-hidden="true" style={{ marginTop: '1rem' }}>
        {[70, 100, 100, 45].map((width, i) => (
          <div
            key={i}
            className="card"
            style={{
              width: `${width}%`,
              height: i === 0 ? '2.5rem' : '4rem',
              marginBottom: '0.75rem',
              background: 'var(--panel-muted, var(--panel))',
            }}
          />
        ))}
      </div>
    </div>
  );
}
