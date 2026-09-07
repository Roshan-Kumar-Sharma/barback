import { describe, expect, it } from 'vitest';
import { caTypeInfo, classifyCa, isCaInClass } from '../src/enrichers/ca_abc/codes.ts';
import { caDate, parseBannerDate, parseCsvLine, parseExport } from '../src/enrichers/ca_abc/dataset.ts';

/** Shaped exactly like the real export: banner line, then header, then rows. */
const CSV = [
  '"Updated Monday 7th of September 2026 03:50:24 AM"',
  '"License Type","File Number","Lic or App","Type Status","Type Orig Iss Date","Expir Date","Fee Codes","Dup Counts","Master Ind","Term in # of Months","Geo Code",District,"Primary Name","Prem Addr 1"," Prem Addr 2","Prem City"," Prem State","Prem Zip","DBA Name","Mail Addr 1","Mail Addr 2","Mail City","Mail State","Mail Zip","Prem County","Prem Census Tract #"',
  '47,00053006,LIC,ACTIVE,"03/15/1999","06/30/2027",P0,"  ",Y,12,3800,3,"R B C C INC","199 VALENCIA ST"," ","SAN FRANCISCO",CA,94103-2320,"ZEITGEIST","199 VALENCIA ST"," ","SAN FRANCISCO",CA,94103,"SAN FRANCISCO",0201.00',
  '48,00099999,LIC,ACTIVE,"01/02/2010","06/30/2027",P0,"  ",Y,12,3800,3,"DARK BAR LLC","1 MARKET ST"," ","SAN FRANCISCO",CA,94105,"THE DARK, BAR","1 MARKET ST"," ","SAN FRANCISCO",CA,94105,"SAN FRANCISCO",0101.00',
  '21,00088888,LIC,ACTIVE,"05/05/2015"," ",P0,"  ",Y,12,3800,3,"CORNER LIQUOR INC","5 MISSION ST"," ","SAN FRANCISCO",CA,94105,"CORNER LIQUOR","5 MISSION ST"," ","SAN FRANCISCO",CA,94105,"SAN FRANCISCO",0101.00',
].join('\n');

describe('CSV parsing', () => {
  it('reads the header from line 2, not the banner on line 1', () => {
    // Treating the banner as the header would produce one garbage row and shift
    // nothing else — the sort of bug that survives a long time unnoticed.
    const index = parseExport(CSV, '2026-09-07T12:00:00.000Z');
    expect(index.rows).toHaveLength(3);
    expect(index.rows[0]?.dba_name).toBe('ZEITGEIST');
  });

  it('takes as_of from the export banner, not the download time', () => {
    expect(parseExport(CSV, '2030-01-01T00:00:00.000Z').as_of).toBe('2026-09-07');
  });

  it('parses the banner date', () => {
    expect(parseBannerDate('"Updated Monday 7th of September 2026 03:50:24 AM"')).toBe('2026-09-07');
    expect(parseBannerDate('"Updated Tuesday 1st of December 2025 01:00:00 AM"')).toBe('2025-12-01');
    expect(parseBannerDate('nonsense')).toBeNull();
  });

  it('handles quoted fields containing commas', () => {
    const f = parseCsvLine('48,1,LIC,ACTIVE,"a,b",""" quoted """,x');
    expect(f[4]).toBe('a,b');
    expect(f[5]).toBe('" quoted "');
  });

  it('indexes on both the DBA and the licensee name', () => {
    const index = parseExport(CSV, '2026-09-07T12:00:00.000Z');
    expect(index.byName.get('ZEITGEIST')).toBeDefined();
    expect(index.byName.get('R B C C')).toBeDefined();
  });

  it('normalises a DBA with punctuation into the index', () => {
    const index = parseExport(CSV, '2026-09-07T12:00:00.000Z');
    expect(index.byName.get('DARK BAR')).toBeDefined();
  });

  it('converts CA dates, tolerating blank and space-filled fields', () => {
    expect(caDate('03/15/1999')).toBe('1999-03-15');
    expect(caDate('6/3/2027')).toBe('2027-06-03');
    expect(caDate(' ')).toBeNull();
    expect(caDate(undefined)).toBeNull();
  });
});

describe('licence types come from ABC documentation, not guesswork', () => {
  it('reads a zero-padded code', () => {
    expect(caTypeInfo('02')?.label).toContain('Winegrower');
    expect(caTypeInfo('47')?.label).toContain('Eating Place');
  });

  it('knows an eating place from a public premises', () => {
    expect(caTypeInfo('47')?.eating_place).toBe(true);
    expect(caTypeInfo('47')?.public_premises).toBe(false);
    expect(caTypeInfo('48')?.public_premises).toBe(true);
    expect(caTypeInfo('48')?.eating_place).toBe(false);
  });

  it('excludes off-sale and non-retail types from the class', () => {
    expect(isCaInClass('21')).toBe(false);
    expect(isCaInClass('20')).toBe(false);
    expect(isCaInClass('47')).toBe(true);
    expect(isCaInClass('48')).toBe(true);
  });

  it('classifies from the licence type', () => {
    expect(classifyCa('47')?.value).toBe('restaurant');
    expect(classifyCa('48')?.value).toBe('bar');
    expect(classifyCa('75')?.value).toBe('brewpub');
    // Type 90 is licensed specifically as a music entertainment facility.
    expect(classifyCa('90')?.value).toBe('nightclub');
    expect(classifyCa('21')).toBeNull();
  });

  it('explains its reasoning', () => {
    expect(classifyCa('48')?.why).toContain('minors may not enter and remain');
    expect(classifyCa('47')?.why).toContain('bona fide eating place');
  });
});
