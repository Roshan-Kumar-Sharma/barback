import { describe, expect, it } from 'vitest';
import { isAllowed, NO_ROBOTS, parseRobots } from '../src/enrichers/web/robots.ts';

const UA = 'barback/0.1';

describe('robots.txt', () => {
  it('allows everything when there is no robots.txt', () => {
    expect(isAllowed(NO_ROBOTS, '/menu')).toBe(true);
  });

  it('honours a wildcard disallow', () => {
    const r = parseRobots('User-agent: *\nDisallow: /admin', UA);
    expect(isAllowed(r, '/admin/login')).toBe(false);
    expect(isAllowed(r, '/menu')).toBe(true);
  });

  it('treats Disallow: / as a total block', () => {
    const r = parseRobots('User-agent: *\nDisallow: /', UA);
    expect(isAllowed(r, '/')).toBe(false);
    expect(isAllowed(r, '/menu')).toBe(false);
  });

  it('treats an empty Disallow as no restriction', () => {
    const r = parseRobots('User-agent: *\nDisallow:', UA);
    expect(isAllowed(r, '/anything')).toBe(true);
  });

  it('lets the longest matching rule win', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\nAllow: /menu', UA);
    expect(isAllowed(r, '/menu')).toBe(true);
    expect(isAllowed(r, '/private')).toBe(false);
  });

  it('prefers a group naming our agent over the wildcard group', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: barback\nDisallow: /admin',
      UA,
    );
    expect(isAllowed(r, '/menu')).toBe(true);
    expect(isAllowed(r, '/admin')).toBe(false);
  });

  it('applies one rule set to consecutive user-agent lines', () => {
    const r = parseRobots('User-agent: foo\nUser-agent: barback\nDisallow: /x', UA);
    expect(isAllowed(r, '/x')).toBe(false);
  });

  it('supports wildcards and end-anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$', UA);
    expect(isAllowed(r, '/menus/lunch.pdf')).toBe(false);
    expect(isAllowed(r, '/menus/lunch.html')).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    const r = parseRobots('# hello\n\nUser-agent: *  # all\nDisallow: /admin', UA);
    expect(isAllowed(r, '/admin')).toBe(false);
  });

  it('matches the real TABC robots.txt', () => {
    const r = parseRobots('User-agent: *\nAllow: /\nDisallow: /search/\nSitemap: https://x/y.xml', UA);
    expect(isAllowed(r, '/search/anything')).toBe(false);
    expect(isAllowed(r, '/public-information/')).toBe(true);
  });
});
