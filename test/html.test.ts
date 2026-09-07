import { describe, expect, it } from 'vitest';
import { extractLinks, htmlToText, rankCandidatePages } from '../src/enrichers/web/html.ts';

describe('htmlToText', () => {
  it('drops scripts and styles entirely', () => {
    const t = htmlToText('<p>Open late</p><script>var fryer="yes"</script><style>.a{}</style>');
    expect(t).toBe('Open late');
  });

  it('keeps block structure as newlines', () => {
    expect(htmlToText('<li>Deep fried pickles</li><li>Wings</li>')).toBe('Deep fried pickles\nWings');
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>Bar &amp; Grill &#8212; 21+</p>')).toContain('Bar & Grill');
  });
});

describe('extractLinks', () => {
  it('resolves relative links and keeps same-origin only', () => {
    const html = '<a href="/menu">M</a><a href="https://other.com/x">X</a><a href="events">E</a>';
    const links = extractLinks(html, 'https://venue.com/');
    expect(links).toContain('https://venue.com/menu');
    expect(links).toContain('https://venue.com/events');
    expect(links.some((l) => l.includes('other.com'))).toBe(false);
  });

  it('skips anchors, mailto and tel', () => {
    const html = '<a href="#top">t</a><a href="mailto:a@b.c">m</a><a href="tel:123">p</a>';
    expect(extractLinks(html, 'https://venue.com/')).toHaveLength(0);
  });
});

describe('rankCandidatePages', () => {
  it('prefers underwriting-relevant pages', () => {
    const ranked = rankCandidatePages([
      'https://v.com/careers',
      'https://v.com/menu',
      'https://v.com/events',
    ], 5);
    expect(ranked).toContain('https://v.com/menu');
    expect(ranked).toContain('https://v.com/events');
    expect(ranked).not.toContain('https://v.com/careers');
  });

  it('prefers a shallow page over a deep one with the same hint', () => {
    const ranked = rankCandidatePages([
      'https://v.com/blog/2019/03/our-new-menu-is-here',
      'https://v.com/menu',
    ], 1);
    expect(ranked[0]).toBe('https://v.com/menu');
  });
});
