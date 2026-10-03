import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveApiKey } from './geminiService';

describe('API key resolution (request prioritized over server env)', () => {
  it('should prefer the key from the request', () => {
    assert.strictEqual(resolveApiKey('REQ-KEY', 'ENV-KEY'), 'REQ-KEY');
  });

  it('should trim whitespace', () => {
    assert.strictEqual(resolveApiKey('  REQ-KEY  ', 'ENV-KEY'), 'REQ-KEY');
  });

  it('should fall back to the server env key when request key is empty', () => {
    assert.strictEqual(resolveApiKey('', 'ENV-KEY'), 'ENV-KEY');
    assert.strictEqual(resolveApiKey('   ', 'ENV-KEY'), 'ENV-KEY');
    assert.strictEqual(resolveApiKey(undefined, 'ENV-KEY'), 'ENV-KEY');
  });

  it('should return empty string when no key is provided anywhere', () => {
    assert.strictEqual(resolveApiKey('', ''), '');
    assert.strictEqual(resolveApiKey(undefined, undefined), '');
  });
});
