import { describe, it, expect } from 'vitest';
import { Money, computeSubsidy, computeEmployeeShare, proratedRideValue } from './money';

describe('Money', () => {
  it('rounds HALF_UP to 2 decimal places', () => {
    expect(Money.fromDecimal(10.005).toString()).toBe('10.01');
    expect(Money.fromDecimal(10.004).toString()).toBe('10.00');
  });

  it('sub() never goes negative', () => {
    const result = Money.fromDecimal(5).sub(Money.fromDecimal(10));
    expect(result.toString()).toBe('0.00');
  });

  it('computeSubsidy applies percentage with correct rounding', () => {
    expect(computeSubsidy(Money.fromDecimal('1200.00'), 60).toString()).toBe('720.00');
  });

  it('computeEmployeeShare is price minus subsidy', () => {
    expect(computeEmployeeShare(Money.fromDecimal('1200.00'), 60).toString()).toBe('480.00');
  });

  it('proratedRideValue divides plan price by rides for finite plans', () => {
    expect(proratedRideValue(Money.fromDecimal('150.00'), 10, Money.fromDecimal('60.00')).toString()).toBe('15.00');
  });

  it('proratedRideValue falls back to route fare for unlimited plans', () => {
    expect(proratedRideValue(Money.fromDecimal('1200.00'), -1, Money.fromDecimal('60.00')).toString()).toBe('60.00');
  });

  it('rejects malformed ETB strings', () => {
    expect(() => Money.fromETBString('12.999')).toThrow();
    expect(() => Money.fromETBString('abc')).toThrow();
  });
});
