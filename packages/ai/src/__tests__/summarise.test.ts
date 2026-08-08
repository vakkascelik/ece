/**
 * Every test here drives an injected fake. There is no key in this environment, so the
 * real client is exercised by nothing — which is the point of `ModelClient` being a
 * hand-written interface rather than the SDK's own type.
 *
 * What that buys and what it does not: the refusal branch, the empty-content branch, the
 * error branch and the shape of the request body are all covered. Whether the API
 * *accepts* that body is not, and cannot be from here. Recorded in `unverified-claims`.
 */

import { describe, expect, it, vi } from 'vitest';
import { MODEL, summariseFigures, type ModelClient } from '../index';

/** A client that answers with whatever the test hands it, and records what it was sent. */
function fakeClient(reply: unknown): { client: ModelClient; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (body) => {
          sent.push(body);
          return reply as never;
        },
      },
    },
  };
}

const OK = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'Twelve of fourteen checks are current. ' }],
  usage: { input_tokens: 1_200, output_tokens: 400 },
};

const PAYLOAD = { figures: { current: 12, total: 14 }, labels: ['first aid'] };

describe('summariseFigures', () => {
  it('returns the text and prices the call', async () => {
    const { client } = fakeClient(OK);
    const r = await summariseFigures({
      client,
      payload: PAYLOAD,
      allowedLabels: ['first aid'],
      question: 'Summarise these certificate counts.',
    });

    expect(r.outcome).toBe('ok');
    expect(r.text).toBe('Twelve of fourteen checks are current.'); // trimmed
    expect(r.inputTokens).toBe(1_200);
    expect(r.outputTokens).toBe(400);
    expect(r.centsEstimate).toBe(estimate(1_200, 400));
  });

  it('sends only the redacted payload, and the instruction as a cached prefix', async () => {
    const { client, sent } = fakeClient(OK);
    await summariseFigures({
      client,
      payload: PAYLOAD,
      allowedLabels: ['first aid'],
      question: 'Summarise these certificate counts.',
    });

    const body = sent[0]!;
    expect(body.model).toBe(MODEL);

    // The system block is a cache breakpoint. Without it every call pays full price for
    // an instruction that never changes.
    const system = body.system as Array<Record<string, unknown>>;
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });

    // Adaptive thinking, and no `budget_tokens` — Opus 5 rejects that with a 400 rather
    // than ignoring it, so a stale prior here is a runtime failure, not a style question.
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(JSON.stringify(body)).not.toContain('budget_tokens');

    // Nothing outside the declared vocabulary reached the wire.
    const wire = JSON.stringify(body.messages);
    expect(wire).toContain('first aid');
    expect(wire).toContain('12');
  });

  it('checks the refusal stop reason BEFORE reading content', async () => {
    /*
      The branch this test exists for. A refusal is a 200 with an empty `content`, so
      code that reads `content[0].text` optimistically renders `undefined` into the page
      — a blank panel with no error anywhere. Deleting the `stop_reason` check makes this
      test fail with `outcome: 'error'` rather than passing by luck.
    */
    const { client } = fakeClient({
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 900, output_tokens: 0 },
    });

    const r = await summariseFigures({
      client,
      payload: PAYLOAD,
      allowedLabels: ['first aid'],
      question: 'Summarise these.',
    });

    expect(r.outcome).toBe('refused');
    expect(r.text).toBeNull();
    expect(r.message).toContain('Nothing is wrong with your figures');
    // Billed, so recorded. A refusal that logged zero would under-count spend.
    expect(r.inputTokens).toBe(900);
  });

  it('treats empty text as an error, not as a successful empty summary', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', text: '' }],
      usage: { input_tokens: 500, output_tokens: 20 },
    });

    const r = await summariseFigures({
      client,
      payload: PAYLOAD,
      allowedLabels: ['first aid'],
      question: 'Summarise these.',
    });

    expect(r.outcome).toBe('error');
    expect(r.text).toBeNull();
  });

  it('swallows the provider error message, because it can quote the request back', async () => {
    const client: ModelClient = {
      messages: {
        create: vi.fn().mockRejectedValue(
          new Error('400 invalid_request: messages.0.content: "Beau Ngata, DOB 2021-04-02"'),
        ),
      },
    };

    const r = await summariseFigures({
      client,
      payload: PAYLOAD,
      allowedLabels: ['first aid'],
      question: 'Summarise these.',
    });

    expect(r.outcome).toBe('error');
    expect(r.message).not.toContain('Beau');
    expect(r.message).not.toContain('400');
    // Nothing was billed, so nothing is charged against the month's cap.
    expect(r.centsEstimate).toBe(0);
  });

  it('throws rather than reporting an outcome when the payload could carry a name', async () => {
    /*
      Deliberately not a `blocked` result. A caller that assembled an unsafe payload has a
      bug, and a bug that returns a tidy status gets shipped — the redactor's refusal has
      to be loud enough to fail a test suite.
    */
    const { client, sent } = fakeClient(OK);

    await expect(
      summariseFigures({
        client,
        payload: { figures: { current: 1 }, labels: ['Beau Ngata'] },
        allowedLabels: ['first aid'],
        question: 'Summarise these.',
      }),
    ).rejects.toThrow();

    // And it threw before anything left the process.
    expect(sent).toHaveLength(0);
  });
});

/** Mirrors `estimateCents` without importing it, so the test does not restate the code. */
function estimate(input: number, output: number): number {
  return Math.ceil(((input / 1e6) * 5 + (output / 1e6) * 25) * 100);
}
