/**
 * Loading carrier appetite files from disk.
 *
 * Illustrative files live in their own directory and are excluded unless asked
 * for. That separation is deliberate: a seed appetite set assembled from public
 * marketing pages is genuinely useful, and a set of invented rules presented as
 * real appetite would be actively dangerous. Keeping them apart on the
 * filesystem makes the two impossible to confuse.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { CarrierFileSchema, toCarrierAppetite } from './schema.js';
import type { CarrierAppetite } from './types.js';

export const ILLUSTRATIVE_DIR = 'illustrative';

export type LoadOptions = {
  /** Include the clearly-marked demonstration files. Off by default. */
  includeIllustrative?: boolean;
};

export async function loadCarriers(dir: string, opts: LoadOptions = {}): Promise<CarrierAppetite[]> {
  const files = await collect(dir, opts.includeIllustrative === true);
  const out: CarrierAppetite[] = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const parsed = CarrierFileSchema.safeParse(parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    }
    const appetite = toCarrierAppetite(parsed.data);

    // A file in the illustrative directory that forgot to say so would defeat
    // the whole separation, so the directory is authoritative.
    if (file.includes(`/${ILLUSTRATIVE_DIR}/`) && !appetite.illustrative) {
      throw new Error(`${file} is in ${ILLUSTRATIVE_DIR}/ but does not set "illustrative: true".`);
    }
    out.push(appetite);
  }

  return out.sort((a, b) => a.carrier.localeCompare(b.carrier));
}

async function collect(dir: string, includeIllustrative: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ILLUSTRATIVE_DIR && !includeIllustrative) continue;
      files.push(...(await collect(full, includeIllustrative)));
    } else if (/\.ya?ml$/.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}
