/**
 * California-specific derivations.
 *
 * Beside the source whose vocabulary they depend on, never in the core.
 */
import { asOfOf, base, val, type Ctx, type Derivation } from '../../core/reduce/derived.js';
import { path } from '../../core/field.js';
import { classifyCa, CA_TYPES_URL } from './codes.js';

/**
 * Operating class from the ABC licence type.
 *
 * California is unusually informative here: the licence type distinguishes a
 * bona fide eating place from a public premises, which is the food-primary
 * versus alcohol-primary question a carrier actually asks.
 */
const venueClass: Derivation = {
  path: path('operations.venue_class'),
  derive(profile, ctx: Ctx) {
    const licenseType = val<string>(profile, 'identity.license_type');
    if (licenseType === null) return null;
    const result = classifyCa(licenseType);
    if (!result) return null;

    return {
      path: path('operations.venue_class'),
      value: result.value,
      confidence: result.confidence,
      as_of: asOfOf(profile, 'identity.license_type'),
      inputs: [path('identity.license_type')],
      evidence_url: CA_TYPES_URL,
      notes: `${result.why}. Classification from the licence type, not the venue's name or self-description.`,
      ...base(ctx),
    };
  },
};

export const CA_DERIVATIONS: readonly Derivation[] = [venueClass];
