import type { FieldPath, SourceId } from '../core/field.js';

export type QuestionReason =
  /** A carrier will not review the submission without it. Outranks everything. */
  | 'submission_requirement'
  /** A carrier hard-declines on this field and we do not know the value. */
  | 'hard_decline_unknown'
  /** A carrier refers on this field and we do not know the value. */
  | 'review_unknown'
  /** Answering it completes another field that is currently blocked. */
  | 'unblocks_derived'
  /** Sources of equal standing disagree; only a person can settle it. */
  | 'conflict'
  /** Populated, but not confidently enough to submit on. */
  | 'low_confidence'
  /** No source in this build can ever produce it. */
  | 'structurally_unavailable'
  /** Sources looked and came back empty. */
  | 'not_found';

export type QuestionCause = {
  kind: QuestionReason;
  detail: string;
  /** Carriers that care, where the cause came from a carrier rule. */
  carriers?: string[];
  weight: number;
};

export type Question = {
  path: FieldPath;
  label: string;
  /** What the broker actually says out loud. */
  ask: string;
  ask_seconds: number;
  priority: number;
  causes: QuestionCause[];
  /** Present when the field has a value that is merely weak or contested. */
  current?: { value: unknown; source: SourceId | 'none'; confidence: number };
  /** Fields that become computable once this is answered. */
  unblocks?: FieldPath[];
};

export type CompletenessReport = {
  carriers: string[];
  populated: number;
  total: number;
  conflicts: number;
  low_confidence: number;
  /** Fields no source in this build can produce, so they are always human. */
  structurally_unavailable: FieldPath[];
  /** Ordered. The minimum set worth asking, highest value first. */
  questions: Question[];
  /** Missing fields nothing gave a reason to ask about. */
  not_worth_asking: number;
  minutes: {
    /** Estimated call time Barback removed. */
    saved: number;
    /** Estimated time the remaining question list takes. */
    remaining: number;
    /** Asking all 101 questions cold. */
    total: number;
  };
};
