import Link from 'next/link';
import { requireCapability } from '@/lib/auth';
import { NewChildForm } from './NewChildForm';

export default async function NewChildPage() {
  const ctx = await requireCapability('manageChildren');
  return (
    <>
      <h1>Enrol a child</h1>
      <p className="sub">At {ctx.centre.name}. Whānau, enrolment dates and consents come next.</p>
      <NewChildForm />
      <p>
        <Link href="/children">Back to children</Link>
      </p>
    </>
  );
}
