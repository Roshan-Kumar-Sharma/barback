/**
 * Texas-specific derivations.
 *
 * These live beside the source whose vocabulary they depend on, not in the
 * core. Operating class is read off TABC licence codes and mixed-beverage
 * filings, so the core has no business knowing how to compute it.
 */
import { asOfOf, base, val, type Ctx, type Derivation } from '../../core/reduce/derived.js';
import { path } from '../../core/field.js';
import { classify } from './codes.js';

/** Operating class, from records rather than from a name or a category string. */
const venueClass: Derivation = {
  path: path('operations.venue_class'),
  derive(profile, ctx: Ctx) {
    const licenseType = val<string>(profile, 'identity.license_type');
    if (licenseType === null) return null;

    const alcohol = val<number>(profile, 'revenue.alcohol_on_premise_sales');
    const cover = val<number>(profile, 'revenue.cover_charge_sales');
    const coverShare =
      alcohol !== null && cover !== null && alcohol + cover > 0 ? cover / (alcohol + cover) : null;

    const result = classify({
      license_type: licenseType,
      food_beverage_certificate: val<boolean>(profile, 'liquor_profile.food_beverage_certificate') === true,
      late_hours: val<boolean>(profile, 'liquor_profile.late_hours_permit') === true,
      cover_charge_share: coverShare,
    });
    if (!result) return null;

    return {
      path: path('operations.venue_class'),
      value: result.value,
      confidence: result.confidence,
      as_of: asOfOf(profile, 'identity.license_type', 'revenue.cover_charge_sales'),
      inputs: [
        path('identity.license_type'),
        path('liquor_profile.food_beverage_certificate'),
        path('liquor_profile.late_hours_permit'),
        path('revenue.cover_charge_sales'),
      ],
      notes: `${result.why.join('; ')}. Classification from records, not from the venue's name or self-description.`,
      ...base(ctx),
    };
  },
};

export const TX_DERIVATIONS: readonly Derivation[] = [venueClass];
