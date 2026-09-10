// eslint-disable-next-line @typescript-eslint/no-var-requires
const canonicalizeFn = require('canonicalize');

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Produces deterministic canonical JSON string.
 */
export function canonicalizeJson(obj: unknown): string {
  const fn = typeof canonicalizeFn === 'function' ? canonicalizeFn : canonicalizeFn.default;
  const result = fn(obj);
  if (result === undefined) {
    throw new Error('JCS canonicalization failed: object resulted in undefined');
  }
  return result;
}
