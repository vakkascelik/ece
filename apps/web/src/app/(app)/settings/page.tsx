import { listRooms } from '@ece/api';
import { sortRooms } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import './settings.css';
import { RoomList } from './RoomList';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const rooms = await listRooms(db, ctx.centre.id);

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
      <RoomList rooms={sortRooms(rooms)} />
    </>
  );
}
