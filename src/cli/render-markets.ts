/** Terminal rendering for the market shortlist and the question list. */
import type { CarrierAssessment, MarketShortlist } from '../appetite/types.js';
import type { CompletenessReport, Question } from '../completeness/types.js';
import type { SubmissionDraft } from '../submission/index.js';

const VERDICT_LABEL: Record<CarrierAssessment['verdict'], string> = {
  eligible: '✅ Eligible',
  needs_review: '⚠️  Needs review',
  hard_decline: '❌ Hard decline',
};

export function renderShortlist(shortlist: MarketShortlist): string {
  const out: string[] = ['\nMarket shortlist'];

  if (shortlist.assessments.length === 0) {
    out.push('  No carriers in footprint for this state and class.');
  }

  for (const a of shortlist.assessments) {
    const tag = a.illustrative ? '  [ILLUSTRATIVE — not a real carrier appetite]' : '';
    out.push(`\n  ${VERDICT_LABEL[a.verdict]} — ${a.label}${tag}`);
    for (const r of a.reasons) out.push(`     ${r}`);
    if (a.blocked_by_unknowns.length > 0) {
      out.push(`     Blocked on ${a.blocked_by_unknowns.length} unknown field(s); see the question list.`);
    }
    out.push(`     Basis: ${a.basis.replace(/\s+/g, ' ').trim()}`);
    out.push(`     Source: ${a.source} (as of ${a.as_of})`);
  }

  if (shortlist.out_of_footprint.length > 0) {
    out.push('\n  Not considered:');
    for (const o of shortlist.out_of_footprint) out.push(`     ${o.label} — ${o.reason}`);
  }
  return out.join('\n');
}

export function renderQuestions(report: CompletenessReport, limit: number): string {
  const out: string[] = [];
  const shown = report.questions.slice(0, limit);

  out.push(
    `\nStill to ask — ${report.questions.length} question(s), about ${report.minutes.remaining} minutes`,
  );
  if (report.carriers.length > 0) {
    out.push(`  Ranked for: ${report.carriers.join(', ')}`);
  } else {
    out.push('  No carrier selected, so ranking falls back to what every carrier asks.');
  }
  out.push('');

  shown.forEach((q, i) => {
    out.push(`  ${String(i + 1).padStart(2)}. ${q.ask}`);
    out.push(`      ${q.label} · ~${q.ask_seconds}s${q.current ? `  (currently: ${short(q.current.value)})` : ''}`);
    for (const c of q.causes.slice(0, 2)) out.push(`      → ${c.detail}`);
    out.push('');
  });

  if (report.questions.length > shown.length) {
    out.push(`  …and ${report.questions.length - shown.length} more. Use --questions <n> to see them.`);
  }
  return out.join('\n');
}

export function renderSavings(report: CompletenessReport): string {
  return [
    '',
    `Intake       ${report.populated}/${report.total} fields filled without a human`,
    `             ~${report.minutes.saved} of ~${report.minutes.total} minutes of questions answered ` +
      `(estimate; per-question times are declared in the field registry)`,
    `             ${report.conflicts} conflict(s) · ${report.low_confidence} low-confidence · ` +
      `${report.structurally_unavailable.length} that no public source can ever fill`,
    `             ${report.not_worth_asking} missing field(s) no target carrier asked about`,
  ].join('\n');
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return `${v.length} item(s)`;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}

export const ILLUSTRATIVE_WARNING =
  '\n⚠️  Carriers marked ILLUSTRATIVE are demonstrations of the rule format, not real\n' +
  '   appetite. Never place business on them. See carriers/illustrative/.\n';

export function hasIllustrative(shortlist: MarketShortlist): boolean {
  return shortlist.assessments.some((a: CarrierAssessment) => a.illustrative);
}

export function renderDraft(draft: SubmissionDraft): string {
  const out: string[] = ['', '─'.repeat(72), `Draft submission — ${draft.label}`, '─'.repeat(72)];

  for (const w of draft.warnings) out.push(`  ⚠️  ${w}`);
  out.push('');
  out.push(`  To:      ${draft.email.to}`);
  out.push(`  Subject: ${draft.email.subject}`);
  out.push('');
  for (const line of draft.email.body.split('\n')) out.push(`  ${line}`);
  out.push('');
  out.push(`  ${draft.field_map.length} field(s) populated · ${draft.outstanding.length} still outstanding`);
  return out.join('\n');
}

export type { Question };
