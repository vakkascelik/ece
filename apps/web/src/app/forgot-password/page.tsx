import { ForgotForm } from './ForgotForm';

/**
 * A server component only so the ?expired=1 that /auth/confirm redirects back
 * with can be read from searchParams — useSearchParams in a client page needs a
 * Suspense boundary, which is more machinery than one flag deserves.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  return <ForgotForm expired={expired === '1'} />;
}
