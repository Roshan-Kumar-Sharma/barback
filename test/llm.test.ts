import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/llm/client.ts';

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads through a preamble and a code fence', () => {
    expect(extractJson('Sure! Here is the result:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('handles nested objects', () => {
    expect(extractJson('x {"a":{"b":[1,2]}} y')).toEqual({ a: { b: [1, 2] } });
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"note":"a } brace","ok":true}')).toEqual({ note: 'a } brace', ok: true });
  });

  it('is not fooled by escaped quotes', () => {
    expect(extractJson('{"note":"say \\"hi\\" }","ok":true}')).toEqual({ note: 'say "hi" }', ok: true });
  });

  it('returns null rather than throwing on malformed output', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"a": }')).toBeNull();
  });
});

describe('extractJson survives reasoning models', () => {
  it('ignores braces in a narrated preamble and finds the real payload', () => {
    // Shape taken from a real free-model response.
    const text =
      `Here's a thinking process:\n1. The schema wants {value, evidence} pairs.\n` +
      `2. I will now answer.\n\n{"hookah_or_oxygen_inhalation":{"value":null,"evidence":null},` +
      `"bottle_service":{"value":true,"evidence":"bottle service available"}}`;
    const out = extractJson(text) as Record<string, unknown>;
    expect(Object.keys(out)).toContain('bottle_service');
    expect(Object.keys(out)).toContain('hookah_or_oxygen_inhalation');
  });

  it('strips explicit thinking tags', () => {
    const out = extractJson('<think>{"a":1,"b":2,"c":3}</think>{"answer":true}');
    expect(out).toEqual({ answer: true });
  });

  it('prefers the richest object when several are present', () => {
    expect(extractJson('{"a":1} then {"a":1,"b":2,"c":3}')).toEqual({ a: 1, b: 2, c: 3 });
  });
});
