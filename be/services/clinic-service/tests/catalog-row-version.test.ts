import { describe, expect, it } from 'vitest';
import { encodeRowVersion } from '../src/modules/organization-catalog/catalog.repository.js';

describe('catalog row-version encoding', () => {
  it('encodes all eight bytes without interpreting them as UTF-8 text', () => {
    expect(encodeRowVersion(Buffer.from('0000000000019fe0', 'hex'))).toBe('AAAAAAABn+A=');
  });

  it('keeps compatibility with hexadecimal row versions', () => {
    expect(encodeRowVersion('0000000000019fe0')).toBe('AAAAAAABn+A=');
  });
});
