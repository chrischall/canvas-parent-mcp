import { describe, it, expect } from 'vitest';
import { textContent, is404, toArray, buildPath, userSegment } from '../../src/tools/_shared.js';

describe('_shared.textContent', () => {
  it('wraps an object as pretty-printed JSON text block', () => {
    expect(textContent({ a: 1 })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }],
    });
  });
  it('wraps an array', () => {
    expect(textContent([1, 2]).content[0].text).toBe('[\n  1,\n  2\n]');
  });
  it('wraps null', () => {
    expect(textContent(null).content[0].text).toBe('null');
  });
  it('wraps a primitive string', () => {
    expect(textContent('hi').content[0].text).toBe('"hi"');
  });
});

describe('_shared.is404', () => {
  it('matches Canvas 404 prefix', () => {
    expect(is404(new Error('Canvas 404 /api/v1/x'))).toBe(true);
  });
  it('rejects other Error messages', () => {
    expect(is404(new Error('Canvas 500'))).toBe(false);
  });
  it('rejects Canvas download 404 (different prefix)', () => {
    expect(is404(new Error('Canvas download 404 for /x'))).toBe(false);
  });
  it('rejects non-Error values', () => {
    expect(is404('Canvas 404')).toBe(false);
    expect(is404(null)).toBe(false);
    expect(is404(undefined)).toBe(false);
    expect(is404({ message: 'Canvas 404 x' })).toBe(false);
  });
});

describe('_shared.toArray', () => {
  it('returns [] for null', () => expect(toArray(null)).toEqual([]));
  it('returns [] for undefined', () => expect(toArray(undefined)).toEqual([]));
  it('passes through arrays', () => expect(toArray([1, 2])).toEqual([1, 2]));
  it('wraps a single object', () => expect(toArray({ a: 1 })).toEqual([{ a: 1 }]));
  it('wraps a falsy primitive (0)', () => expect(toArray(0)).toEqual([0]));
  it('wraps an empty string', () => expect(toArray('')).toEqual(['']));
});

describe('_shared.buildPath', () => {
  it('returns base when no params provided', () => {
    expect(buildPath('/x')).toBe('/x');
  });
  it('returns base when all params undefined/null', () => {
    expect(buildPath('/x', { a: undefined, b: null })).toBe('/x');
  });
  it('encodes scalar string params', () => {
    expect(buildPath('/x', { foo: 'bar baz' })).toBe('/x?foo=bar%20baz');
  });
  it('encodes numeric params', () => {
    expect(buildPath('/x', { n: 42 })).toBe('/x?n=42');
  });
  it('encodes boolean params as true/false', () => {
    expect(buildPath('/x', { ok: true, no: false })).toBe('/x?ok=true&no=false');
  });
  it('repeats array values with the same key (Canvas include[] shape)', () => {
    expect(buildPath('/x', { 'include[]': ['a', 'b'] }))
      .toBe('/x?include%5B%5D=a&include%5B%5D=b');
  });
  it('joins multiple params with &', () => {
    expect(buildPath('/x', { a: '1', b: '2' })).toBe('/x?a=1&b=2');
  });
});

describe('_shared.userSegment', () => {
  it('returns users/self when observeeId is undefined', () => {
    expect(userSegment()).toBe('users/self');
    expect(userSegment(undefined)).toBe('users/self');
  });
  it('returns users/{id} when observeeId is set, encoded', () => {
    expect(userSegment('123')).toBe('users/123');
    expect(userSegment('a b')).toBe('users/a%20b');
  });
});
