import { listRooms, listServiceClosures } from '@ece/api';
import { sortRooms, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import './settings.css';
import { ClosureList } from './ClosureList';
import { RoomList } from './RoomList';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const [rooms, closures] = await Promise.all([
    listRooms(db, ctx.centre.id),
    listServiceClosures(db, ctx.centre.id),
  ]);

  /*
    The centre's date, not the server's. A Next server runs in UTC, which is yesterday for the
    whole New Zealand morning — and this value decides both what "closed today" means and what
    the date fields default to. The same boundary that made an e2e assertion true for only half
    the day on 2026-09-04.
  */
  const today = todayInZone(ctx.centre.timezone);

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
        licenceType={ctx.centre.licenceType}
        serviceModel={ctx.centre.serviceModel}
      />
      <RoomList rooms={sortRooms(rooms)} />
      <ClosureList closures={closures} today={today} />
    </>
  );
}
