/**
 * Orchestrator conformance suite.
 *
 * Every Orchestrator implementation must pass this identical suite. The port in
 * pipeline/port.ts is only an honest boundary if the in-process runner and the
 * Temporal runner behave the same way; a fallback that quietly differs would
 * make the local path a toy and the abstraction a lie.
 *
 * The Temporal implementation lands in slice 6 and is wired into this same
 * suite rather than getting tests of its own.
 */
import { expect, it } from 'vitest';
import type { Enricher, EnricherContext, Fetched, Logger } from '../src/core/enricher.js';
import { path, type FieldCandidate } from '../src/core/field.js';
import type { Venue } from '../src/core/venue.js';
import type { Orchestrator, OrchestratorContext } from '../src/pipeline/port.js';

export const NOW = new Date('2026-09-07T12:00:00.000Z');

export const VENUE: Venue = {
  id: 'TX:200097471',
  state: 'TX',
  trade_name: 'Test Venue',
  legal_name: 'Test Venue LLC',
  address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' },
  license_id: '200097471',
  permit_number: 'MB200097471',
  license_type: 'MB',
};

const silentLog: Logger = { debug: () => {}, info: () => {}, warn: () => {} };

const noopFetched: Fetched = {
  body: null, status: 200, ref: 'test', retrieved_at: NOW.toISOString(), from_cache: true, url: 'test://',
};

export function makeCtx(over: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    fetcherFor: () => ({ get: async () => noopFetched }),
    now: () => NOW,
    log: silentLog,
    signal: new AbortController().signal,
    ...over,
  };
}

type FakeOpts = {
  id: Enricher['id'];
  requires?: Enricher['requires'];
  produces?: string[];
  emit?: FieldCandidate[];
  patch?: Partial<Venue>;
  throws?: string;
  delayMs?: number;
  onRun?: () => void;
};

export function fakeEnricher(o: FakeOpts): Enricher {
  return {
    id: o.id,
    produces: (o.produces ?? ['identity.trade_name']).map(path),
    requires: o.requires ?? [],
    attribution: { name: o.id, url: 'https://example.invalid/', license: 'test' },
    async run(_v: Venue, _ctx: EnricherContext) {
      o.onRun?.();
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.throws) throw new Error(o.throws);
      return {
        fields: o.emit ?? [],
        ...(o.patch ? { venue_patch: o.patch } : {}),
      };
    },
  };
}

export const candidate = (p: string, value: unknown): FieldCandidate => ({
  path: path(p),
  value,
  source: 'tabc_license',
  method: 'record',
  confidence: 0.9,
  as_of: '2026-08-31',
  retrieved_at: NOW.toISOString(),
});

/** Run this against every Orchestrator implementation. */
export function conformanceSuite(make: () => Orchestrator): void {
  it('collects candidates from every enricher that ran', async () => {
    const run = await make().run(VENUE, [
      fakeEnricher({ id: 'tabc_license', emit: [candidate('identity.trade_name', 'A')] }),
      fakeEnricher({ id: 'tabc_receipts', emit: [candidate('revenue.total_sales', 100)] }),
    ], makeCtx());
    expect(run.candidates).toHaveLength(2);
    expect(run.ran_by.map((r) => r.id).sort()).toEqual(['tabc_license', 'tabc_receipts']);
    expect(run.steps.every((s) => s.status === 'ok')).toBe(true);
  });

  it('isolates a failing enricher: the run continues and the rest survives', async () => {
    const run = await make().run(VENUE, [
      fakeEnricher({ id: 'tabc_license', throws: 'portal exploded' }),
      fakeEnricher({ id: 'tabc_receipts', emit: [candidate('revenue.total_sales', 100)] }),
    ], makeCtx());

    expect(run.candidates).toHaveLength(1);
    const failed = run.steps.find((s) => s.source === 'tabc_license');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('portal exploded');
    // A failed source must not be credited as having looked for its fields,
    // or the profile would claim "we checked and found nothing".
    expect(run.ran_by.map((r) => r.id)).not.toContain('tabc_license');
  });

  it('defers an enricher until another supplies what it declared it needs', async () => {
    const order: string[] = [];
    const run = await make().run(VENUE, [
      fakeEnricher({
        id: 'web',
        requires: ['website'],
        emit: [candidate('entertainment.bottle_service', true)],
        onRun: () => order.push('web'),
      }),
      fakeEnricher({
        id: 'osm',
        patch: { website: 'https://example.invalid/' },
        onRun: () => order.push('osm'),
      }),
    ], makeCtx());

    expect(order).toEqual(['osm', 'web']);
    expect(run.candidates).toHaveLength(1);
    expect(run.venue.website).toBe('https://example.invalid/');
    expect(run.steps.every((s) => s.status === 'ok')).toBe(true);
  });

  it('skips an enricher whose requirement never arrives, and says which', async () => {
    const run = await make().run(VENUE, [
      fakeEnricher({ id: 'web', requires: ['website'] }),
      fakeEnricher({ id: 'tabc_license', emit: [candidate('identity.trade_name', 'A')] }),
    ], makeCtx());

    const skipped = run.steps.find((s) => s.source === 'web');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.reason).toContain('website');
  });

  it('terminates rather than looping when a requirement can never be met', async () => {
    const run = await make().run(VENUE, [
      fakeEnricher({ id: 'web', requires: ['website'] }),
      fakeEnricher({ id: 'osm', requires: ['geo'] }),
    ], makeCtx());
    expect(run.steps).toHaveLength(2);
    expect(run.steps.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('is idempotent: the same inputs produce the same fields', async () => {
    const build = () => [
      fakeEnricher({ id: 'tabc_license', emit: [candidate('identity.trade_name', 'A')] }),
      fakeEnricher({ id: 'tabc_receipts', emit: [candidate('revenue.total_sales', 100)] }),
    ];
    const a = await make().run(VENUE, build(), makeCtx());
    const b = await make().run(VENUE, build(), makeCtx());
    expect(b.candidates).toEqual(a.candidates);
    expect(b.venue).toEqual(a.venue);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const track = (id: Enricher['id']) => fakeEnricher({
      id,
      delayMs: 20,
      onRun: () => { inFlight++; peak = Math.max(peak, inFlight); setTimeout(() => inFlight--, 20); },
    });
    await make().run(VENUE, [track('tabc_license'), track('tabc_receipts'), track('osm'), track('web')],
      makeCtx({ concurrency: 2 }));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('accounts for cost and duration', async () => {
    const run = await make().run(VENUE, [
      fakeEnricher({ id: 'tabc_license', emit: [candidate('identity.trade_name', 'A')] }),
    ], makeCtx());
    expect(run.cost_usd).toBe(0);
    expect(run.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.started_at).toBe(NOW.toISOString());
  });
}
