/** Terminal rendering of a RiskProfile. The reviewer is a broker: function over finish. */
import type { Field } from '../core/field.js';
import { ALL_FIELD_PATHS, getField, meta, PROFILE_GROUPS, type FieldFormat, type RiskProfile } from '../core/schema/index.js';
import { SOURCE_LABEL } from '../core/reduce/precedence.js';
import type { EnrichmentRun } from '../pipeline/port.js';

const GROUP_TITLE: Record<string, string> = {
  identity: 'Identity',
  operations: 'Operations',
  revenue: 'Revenue',
  liquor_profile: 'Liquor profile',
  entertainment: 'Entertainment',
  security_controls: 'Security controls',
  property: 'Property',
  fire_protection: 'Fire protection',
  loss_history: 'Loss history',
  coverage_requested: 'Coverage requested',
};

function fmt(v: unknown, format?: FieldFormat): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (format === 'year') return String(Math.round(v));
    if (format === 'usd') return `$${Math.round(v).toLocaleString('en-US')}`;
    if (format === 'percent') return `${(v * 100).toFixed(1)}%`;
    return Number.isInteger(v) ? v.toLocaleString('en-US') : String(v);
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `${v.length} record(s)`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('line1' in o) return [o['line1'], o['city'], o['state'], o['zip']].filter(Boolean).join(', ');
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Provenance badge.
 *
 * Must show the METHOD, not just the source. A closing time derived from the
 * existence of a Late Hours Certificate is not a government record of a closing
 * time — the record says what is permitted, the derivation says what follows.
 * Labelling it "government record" would be exactly the unattributed-value
 * problem the schema exists to prevent.
 */
function badge(f: Field<unknown>): string {
  if (f.value === null) return '';
  const pct = `${(f.confidence * 100).toFixed(0)}%`;
  if (f.source === 'none' || f.method === 'none') return pct;
  const origin = SOURCE_LABEL[f.source];
  switch (f.method) {
    case 'record':
    case 'api':
      return `${origin} · ${pct}`;
    case 'derived':
      return f.source === 'derived' ? `derived · ${pct}` : `derived from ${origin} · ${pct}`;
    case 'inferred':
      return `inferred from ${origin} · ${pct}`;
  }
}

export function renderProfile(profile: RiskProfile, opts: { showEmpty: boolean }): string {
  const out: string[] = [];
  for (const group of PROFILE_GROUPS) {
    const rows: string[] = [];
    for (const p of ALL_FIELD_PATHS) {
      if (!p.startsWith(`${group}.`)) continue;
      const f = getField(profile, p);
      if (!f) continue;
      const known = f.value !== null;
      if (!known && !opts.showEmpty) continue;

      const m = meta(p);
      const flag = f.conflict ? '⚠' : known ? ' ' : '·';
      const label = m.label.padEnd(30).slice(0, 30);
      const value = fmt(f.value, m.format).padEnd(28).slice(0, 28);
      rows.push(`  ${flag} ${label} ${value} ${badge(f)}`);
      if (f.conflict) rows.push(`      conflict: ${f.conflict.reason}`);
    }
    if (rows.length > 0) {
      out.push(`\n${GROUP_TITLE[group] ?? group}`);
      out.push(...rows);
    }
  }
  return out.join('\n');
}

export type Coverage = {
  populated: number;
  total: number;
  seconds_answered: number;
  seconds_total: number;
  remaining_questions: number;
};

/**
 * Broker-minutes saved.
 *
 * Sums the estimated call time of the questions Barback answered. The
 * per-question estimates are exactly that — estimates — and are declared in the
 * field registry so they can be argued with rather than asserted in a README.
 */
export function coverage(profile: RiskProfile): Coverage {
  let populated = 0;
  let secondsAnswered = 0;
  let secondsTotal = 0;
  let remaining = 0;
  for (const p of ALL_FIELD_PATHS) {
    const f = getField(profile, p);
    const m = meta(p);
    secondsTotal += m.ask_seconds;
    if (f && f.value !== null && !f.conflict) {
      populated++;
      secondsAnswered += m.ask_seconds;
    } else {
      remaining++;
    }
  }
  return {
    populated,
    total: ALL_FIELD_PATHS.length,
    seconds_answered: secondsAnswered,
    seconds_total: secondsTotal,
    remaining_questions: remaining,
  };
}

export function renderRun(run: EnrichmentRun & { kindLabel?: string }, cov: Coverage): string {
  const lines: string[] = ['\nSources'];
  for (const s of run.steps) {
    const mark = s.status === 'ok' ? '✓' : s.status === 'skipped' ? '–' : '✗';
    const detail =
      s.status === 'ok'
        ? `${s.fields_emitted} field(s) in ${s.duration_ms}ms` +
          (s.tokens ? ` · ${s.tokens.toLocaleString('en-US')} tokens` : '')
        : s.status === 'skipped' ? (s.reason ?? 'skipped')
        : (s.error ?? 'failed');
    lines.push(`  ${mark} ${s.source.padEnd(16)} ${detail}`);
  }
  lines.push(
    '',
    `Coverage      ${cov.populated}/${cov.total} fields populated without a human`,
    `Est. time     ${(cov.seconds_answered / 60).toFixed(0)} of ${(cov.seconds_total / 60).toFixed(0)} minutes of intake questions answered`,
    `Still to ask  ${cov.remaining_questions} questions`,
    `Run           ${(run.duration_ms / 1000).toFixed(1)}s · $${run.cost_usd.toFixed(4)}` +
      (run.tokens ? ` · ${run.tokens.toLocaleString('en-US')} tokens` : '') +
      ` · ${run.kindLabel ?? ''}${run.run_id}`,
  );
  return lines.join('\n');
}

export const DISCLAIMER =
  '\nNot insurance advice. Barback does not rate, quote or bind coverage. Every field\n' +
  'must be verified by a licensed producer before it reaches an underwriter.\n';
