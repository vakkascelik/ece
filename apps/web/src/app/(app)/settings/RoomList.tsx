'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Room } from '@ece/core';
import { addRoom, archiveRoom, renameRoom, type RoomResult } from './actions';

/**
 * The centre's rooms.
 *
 * The list every picker in the product reads: which room an incident happened in,
 * where a hazard is, which room a checklist was run for. It is also the one table in
 * this phase a **parent** can read, because `incidents.room_id` would otherwise
 * render blank for the family the incident exists to inform — see the header of 0066.
 * Nothing on this screen says so, because a room name is not a disclosure anybody
 * needs warning about; it is written down in the migration and in the wiki.
 */
export function RoomList({ rooms }: { rooms: Room[] }) {
  const [adding, setAdding] = useState(false);
  const live = rooms.filter((r) => r.archivedAt === null);
  const archived = rooms.filter((r) => r.archivedAt !== null);

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Rooms</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Named spaces — Infant, Playground 1, Kitchen. Used to say where something happened.
      </p>

      {live.length === 0 ? (
        <p className="empty">No rooms yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th style={{ width: '6rem' }}>Order</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <Row key={r.id} room={r} />
            ))}
          </tbody>
        </table>
      )}

      {!adding ? (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Add a room
          </button>
        </p>
      ) : (
        <AddForm nextSort={(live.length + 1) * 10} onDone={() => setAdding(false)} />
      )}

      {archived.length > 0 && (
        <>
          <h3 style={{ marginBottom: '0.25rem' }}>Closed</h3>
          <p className="sub" style={{ marginTop: 0, fontSize: '0.8125rem' }}>
            Out of every picker, and still readable on the records that reference them. Rooms are
            never deleted for exactly that reason.
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {archived.map((r) => (
              <li key={r.id} style={{ marginBottom: '0.35rem' }}>
                {r.name} <Restore room={r} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ room }: { room: Room }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<RoomResult | null, FormData>(renameRoom, null);
  const [, archiveAction, archiving] = useActionState<RoomResult | null, FormData>(
    archiveRoom,
    null,
  );

  useEffect(() => {
    if (state && 'ok' in state) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <tr>
        <td colSpan={3}>
          <form action={action}>
            {state && 'error' in state && (
              <p className="error" role="alert">
                {state.error}
              </p>
            )}
            <input type="hidden" name="id" value={room.id} />
            <div className="field">
              <label htmlFor={`name-${room.id}`}>Name</label>
              <input id={`name-${room.id}`} name="name" type="text" required defaultValue={room.name} />
            </div>
            <div className="field">
              <label htmlFor={`sort-${room.id}`}>Order</label>
              <input
                id={`sort-${room.id}`}
                name="sort"
                type="number"
                defaultValue={room.sort}
                style={{ width: '6rem' }}
              />
            </div>
            <div className="inline">
              <button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </button>
              <button className="secondary" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{room.name}</td>
      <td>{room.sort}</td>
      <td>
        <span className="inline">
          <button className="small secondary" type="button" onClick={() => setEditing(true)}>
            Rename
          </button>
          <form action={archiveAction} style={{ display: 'inline' }}>
            <input type="hidden" name="id" value={room.id} />
            <button className="small secondary" type="submit" disabled={archiving}>
              Close
            </button>
          </form>
        </span>
      </td>
    </tr>
  );
}

function Restore({ room }: { room: Room }) {
  const [, action, pending] = useActionState<RoomResult | null, FormData>(archiveRoom, null);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={room.id} />
      <input type="hidden" name="restore" value="yes" />
      <button className="small secondary" type="submit" disabled={pending}>
        Reopen
      </button>
    </form>
  );
}

function AddForm({ nextSort, onDone }: { nextSort: number; onDone: () => void }) {
  const [state, action, pending] = useActionState<RoomResult | null, FormData>(addRoom, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <div className="field">
        <label htmlFor="room-name">Name</label>
        <input id="room-name" name="name" type="text" required placeholder="Toddler" />
      </div>
      <div className="field">
        <label htmlFor="room-sort">Order</label>
        <input
          id="room-sort"
          name="sort"
          type="number"
          defaultValue={nextSort}
          style={{ width: '6rem' }}
        />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Lower first. Most centres want youngest first, which is not alphabetical.
        </p>
      </div>
      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add room'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
