import { requireCapability } from '@/lib/auth';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const ctx = await requireCapability('manageCentre');

  return (
    <>
      <h1>Settings</h1>
      <p className="sub">Details for {ctx.centre.name}.</p>
      <SettingsForm
        name={ctx.centre.name}
        moeServiceNumber={ctx.centre.moeServiceNumber}
        medicationRequiresWitness={ctx.centre.medicationRequiresWitness}
        sleepCheckMinutes={ctx.centre.sleepCheckMinutes}
        drillIntervalDays={ctx.centre.drillIntervalDays}
        ratioSource={ctx.centre.ratioSource}
      />
    </>
  );
}
