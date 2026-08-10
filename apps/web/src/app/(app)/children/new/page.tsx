import Link from 'next/link';
import { requireCapability } from '@/lib/auth';
import { NewChildForm } from './NewChildForm';
import { PageHeader } from '../../PageHeader';

export default async function NewChildPage() {
  const ctx = await requireCapability('manageChildren');
  return (
    <>
      <PageHeader
        title="Enrol a child"
        subtitle={<>At {ctx.centre.name}. Whānau, enrolment dates and consents come next.</>}
      />
      <NewChildForm />
      <p>
        <Link href="/children">Back to children</Link>
      </p>
    </>
  );
}
