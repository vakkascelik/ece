import { requireCapability } from '@/lib/auth';
import { PageHeader } from '../PageHeader';
import './settings.css';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const ctx = await requireCapability('manageCentre');

  return (
    <>
      <PageHeader
        title="Settings"
        helpHref="/settings"
        subtitle={<>Details for {ctx.centre.name}.</>}
      />
      <SettingsForm
        name={ctx.centre.name}
        moeServiceNumber={ctx.centre.moeServiceNumber}
        medicationRequiresWitness={ctx.centre.medicationRequiresWitness}
        sleepCheckMinutes={ctx.centre.sleepCheckMinutes}
        drillIntervalDays={ctx.centre.drillIntervalDays}
        ratioSource={ctx.centre.ratioSource}
        aiFeatures={ctx.centre.aiFeatures}
        licensedPlaces={ctx.centre.licensedPlaces}
      />
    </>
  );
}
