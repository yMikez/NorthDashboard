import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fixturePayment from './__fixtures__/glyco-on-payment.json';
import { computeDigistoreSignature, verifyDigistoreSignature } from './signature';

const payment = fixturePayment as Record<string, string>;

describe('computeDigistoreSignature', () => {
  it('matches manual SHA-512 for a tiny sorted payload', () => {
    const params = { b: '2', A: '1', c: '3' };
    const pass = 'secret';
    const expectedInput = `A=1${pass}b=2${pass}c=3${pass}`;
    const expected = createHash('sha512').update(expectedInput, 'utf8').digest('hex');
    expect(computeDigistoreSignature(params, pass)).toBe(expected);
  });

  it('sorts keys case-sensitively (PHP SORT_STRING)', () => {
    // Case-sensitive ASCII: uppercase letters sort before lowercase (A=0x41 < z=0x7A).
    const params = { zebra: 'z', Apple: 'a' };
    const pass = 'p';
    const input = `Apple=a${pass}zebra=z${pass}`;
    const expected = createHash('sha512').update(input, 'utf8').digest('hex');
    expect(computeDigistoreSignature(params, pass)).toBe(expected);
  });

  it('skips pairs with empty string values', () => {
    const withEmpty = { a: '1', b: '', c: '3' };
    const withoutEmpty = { a: '1', c: '3' };
    const pass = 'p';
    expect(computeDigistoreSignature(withEmpty, pass)).toBe(
      computeDigistoreSignature(withoutEmpty, pass),
    );
  });

  it('skips pairs with undefined/null values', () => {
    const withNil = { a: '1', b: undefined as unknown as string, c: '3' };
    const without = { a: '1', c: '3' };
    const pass = 'p';
    expect(computeDigistoreSignature(withNil, pass)).toBe(
      computeDigistoreSignature(without, pass),
    );
  });

  it('sorts with ASCII order (underscore after digits), matching PHP ksort', () => {
    // Digistore signs using PHP ksort (ASCII), not locale-aware collation.
    // In ASCII: digit 2 (0x32) < underscore (0x5F), so address_street2 < address_street_name.
    // localeCompare would give the opposite order, breaking signature parity.
    const params = {
      address_street_name: 'Perras',
      address_street2: 'apt 5',
      address_street: '36 Perras',
    };
    const pass = 'p';
    // Expected ASCII order: address_street, address_street2, address_street_name
    const input =
      `address_street=36 Perras${pass}` +
      `address_street2=apt 5${pass}` +
      `address_street_name=Perras${pass}`;
    const expected = createHash('sha512').update(input, 'utf8').digest('hex');
    expect(computeDigistoreSignature(params, pass)).toBe(expected);
  });

  it('excludes sha_sign from the hashed content', () => {
    const withSig = { foo: 'bar', sha_sign: 'XYZ' };
    const without = { foo: 'bar' };
    expect(computeDigistoreSignature(withSig, 'p')).toBe(computeDigistoreSignature(without, 'p'));
  });
});

describe('verifyDigistoreSignature', () => {
  it('returns MISSING when sha_sign is absent', () => {
    const params = { foo: 'bar' };
    expect(verifyDigistoreSignature(params, 'p')).toBe('MISSING');
  });

  it('returns MISSING when sha_sign is the Digistore placeholder', () => {
    const params = { foo: 'bar', sha_sign: 'no_signature_passphrase_provided' };
    expect(verifyDigistoreSignature(params, 'p')).toBe('MISSING');
  });

  it('returns MISSING when passphrase is undefined', () => {
    const params = { foo: 'bar', sha_sign: 'AABBCC' };
    expect(verifyDigistoreSignature(params, undefined)).toBe('MISSING');
  });

  it('returns VALID when sha_sign matches computed hash', () => {
    const pass = 'testpassphrase';
    const params = { foo: 'bar', baz: '42' };
    const sig = computeDigistoreSignature(params, pass);
    expect(verifyDigistoreSignature({ ...params, sha_sign: sig }, pass)).toBe('VALID');
  });

  it('is case-insensitive on the signature comparison', () => {
    const pass = 'p';
    const params = { foo: 'bar' };
    const sig = computeDigistoreSignature(params, pass).toUpperCase();
    expect(verifyDigistoreSignature({ ...params, sha_sign: sig }, pass)).toBe('VALID');
  });

  it('returns INVALID when passphrase is wrong for real payload', () => {
    expect(verifyDigistoreSignature(payment, 'wrong-passphrase')).toBe('INVALID');
  });
});
