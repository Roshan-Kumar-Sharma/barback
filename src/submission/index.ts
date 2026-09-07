/**
 * Submission drafter.
 *
 * Produces a populated field map and a drafted underwriter email — a DRAFT, for
 * a licensed producer to check and send. Barback has no code path that emails
 * anyone, and adding one would be the single worst change you could make to it.
 *
 * The email is assembled from a deterministic template rather than written by a
 * model, and that is a deliberate choice rather than laziness. This document is
 * the thing an underwriter prices a risk from. A model drafting it could
 * introduce a fact that no source supports — a capacity, a closing time, a
 * reassuring adjective — and the entire premise of this project is that every
 * fact carries provenance. A template can only interpolate values that already
 * exist in the profile, so it cannot invent one.
 *
 * The email also states what is NOT known. An underwriter who can see the gaps
 * can price around them or ask; an underwriter who discovers them later stops
 * trusting the broker.
 */
import type { CarrierAssessment } from '../appetite/types.js';
import type { CompletenessReport, Question } from '../completeness/types.js';
import type { Field, FieldPath, SourceId } from '../core/field.js';
import {
  ALL_FIELD_PATHS, getField, meta, PROFILE_GROUPS, type FieldFormat, type RiskProfile,
} from '../core/schema/index.js';
import type { Venue } from '../core/venue.js';

export type MappedField = {
  path: FieldPath;
  label: string;
  group: string;
  value: unknown;
  source: SourceId | 'none';
  method: Field<unknown>['method'];
  confidence: number;
  as_of: string | null;
  evidence_url?: string;
  /** May contain personal data; redacted in published output. */
  sensitive: boolean;
  /** How the value should be rendered. A year is not a quantity. */
  format?: FieldFormat;
};

export type SubmissionDraft = {
  carrier: string;
  label: string;
  venue: { trade_name: string; address: string; license: string };
  field_map: MappedField[];
  outstanding: Question[];
  email: { to: string; subject: string; body: string };
  warnings: string[];
};

export type DraftInput = {
  profile: RiskProfile;
  venue: Venue;
  assessment: CarrierAssessment;
  completeness: CompletenessReport;
  /** Redact fields flagged sensitive — for anything published or demoed. */
  redact?: boolean;
  /** Confidence below which a value is presented as unconfirmed. */
  confidenceFloor?: number;
};

export const REDACTED = '[redacted — personal data]';

export function draftSubmission(input: DraftInput): SubmissionDraft {
  const floor = input.confidenceFloor ?? 0.6;
  const fieldMap: MappedField[] = [];

  for (const p of ALL_FIELD_PATHS) {
    const f = getField(input.profile, p);
    if (!f || f.value === null) continue;
    const m = meta(p);
    const sensitive = m.sensitive === true;

    fieldMap.push({
      path: p,
      label: m.label,
      group: m.group,
      value: sensitive && input.redact === true ? REDACTED : f.value,
      source: f.source,
      method: f.method,
      confidence: f.confidence,
      as_of: f.as_of,
      ...(f.evidence_url ? { evidence_url: f.evidence_url } : {}),
      sensitive,
      ...(m.format ? { format: m.format } : {}),
    });
  }

  const warnings = buildWarnings(input, fieldMap, floor);
  const outstanding = input.completeness.questions.filter((q) => q.current === undefined);

  return {
    carrier: input.assessment.carrier,
    label: input.assessment.label,
    venue: {
      trade_name: input.venue.trade_name,
      address: `${input.venue.address.line1}, ${input.venue.address.city}, ${input.venue.address.state} ${input.venue.address.zip}`,
      license: `${input.venue.license_type ?? '—'} ${input.venue.license_id ?? '—'}`,
    },
    field_map: fieldMap,
    outstanding,
    email: buildEmail(input, fieldMap, outstanding, floor),
    warnings,
  };
}

function buildWarnings(input: DraftInput, fields: MappedField[], floor: number): string[] {
  const warnings: string[] = ['This is a DRAFT. Nothing has been sent. A licensed producer must verify every field before it goes to a carrier.'];

  if (input.assessment.verdict === 'hard_decline') {
    warnings.push(
      `${input.assessment.label} shows a HARD DECLINE on the information held. Sending this would burn ` +
      'underwriter goodwill for no chance of a quote.',
    );
  }
  if (input.assessment.missing_submission_requirements.length > 0) {
    warnings.push(
      `${input.assessment.missing_submission_requirements.length} required submission item(s) are missing. ` +
      'Underwriters routinely ignore incomplete submissions.',
    );
  }
  const weak = fields.filter((f) => f.confidence < floor);
  if (weak.length > 0) {
    warnings.push(`${weak.length} field(s) are below ${Math.round(floor * 100)}% confidence and are marked unconfirmed in the email.`);
  }
  if (input.assessment.illustrative) {
    warnings.push('This carrier file is ILLUSTRATIVE — a demonstration of the rule format, not a real appetite. Do not place business on it.');
  }
  if (fields.some((f) => f.sensitive) && input.redact !== true) {
    warnings.push('Draft contains a licensee name that may be a natural person. Use --redact for anything published.');
  }
  return warnings;
}

function buildEmail(
  input: DraftInput,
  fields: MappedField[],
  outstanding: Question[],
  floor: number,
): SubmissionDraft['email'] {
  const v = input.venue;
  const known = fields.filter((f) => f.confidence >= floor);
  const unconfirmed = fields.filter((f) => f.confidence < floor);

  const lines: string[] = [];
  lines.push(`Please consider the following ${describeClass(input.profile)} risk for ${input.assessment.label}.`);
  lines.push('');
  lines.push(`${v.trade_name}`);
  lines.push(`${v.address.line1}, ${v.address.city}, ${v.address.state} ${v.address.zip}`);
  lines.push('');

  for (const group of PROFILE_GROUPS) {
    const rows = known.filter((f) => f.group === group);
    if (rows.length === 0) continue;
    lines.push(`${titleOf(group)}`);
    for (const r of rows) lines.push(`  ${r.label}: ${format(r.value, r.format)}`);
    lines.push('');
  }

  if (unconfirmed.length > 0) {
    lines.push('Unconfirmed (held at low confidence, treat as indicative):');
    for (const r of unconfirmed) lines.push(`  ${r.label}: ${format(r.value, r.format)}`);
    lines.push('');
  }

  if (outstanding.length > 0) {
    lines.push('Still being confirmed with the insured:');
    for (const q of outstanding.slice(0, 12)) lines.push(`  ${q.label}`);
    if (outstanding.length > 12) lines.push(`  …and ${outstanding.length - 12} further items`);
    lines.push('');
  }

  lines.push('Data provenance: figures above are drawn from state licence and tax records,');
  lines.push('OpenStreetMap and the venue\'s own website. Every field carries a source and a');
  lines.push('record date, available on request.');
  lines.push('');
  lines.push('[Producer name] · [licence number] · [contact]');

  return {
    to: '[underwriter email — not populated; Barback never sends]',
    subject: `Submission — ${v.trade_name}, ${v.address.city} ${v.address.state} — ${describeClass(input.profile)}`,
    body: lines.join('\n'),
  };
}

function describeClass(profile: RiskProfile): string {
  const cls = getField(profile, 'operations.venue_class' as FieldPath)?.value;
  return typeof cls === 'string' ? cls : 'bar / restaurant';
}

const titleOf = (g: string): string =>
  g.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

function format(v: unknown, hint?: FieldFormat): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    if (hint === 'year') return String(Math.round(v));
    if (hint === 'usd') return `$${Math.round(v).toLocaleString('en-US')}`;
    if (hint === 'percent') return `${(v * 100).toFixed(1)}%`;
    return v.toLocaleString('en-US');
  }
  if (Array.isArray(v)) return `${v.length} record(s) attached separately`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('line1' in o) return [o['line1'], o['city'], o['state'], o['zip']].filter(Boolean).join(', ');
    if ('present' in o) {
      const a = v as { present: boolean; per_week: number | null };
      return a.present ? (a.per_week ? `Yes, ${a.per_week}×/week` : 'Yes') : 'No';
    }
    return JSON.stringify(v);
  }
  return String(v);
}
