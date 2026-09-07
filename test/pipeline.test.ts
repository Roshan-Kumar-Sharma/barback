import { describe } from 'vitest';
import { LocalOrchestrator } from '../src/pipeline/local.js';
import { conformanceSuite } from './orchestrator-conformance.js';

describe('LocalOrchestrator', () => {
  conformanceSuite(() => new LocalOrchestrator());
});
