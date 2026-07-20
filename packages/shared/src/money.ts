import { Decimal } from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export class Money {
  static ZERO = new Money(new Decimal(0));
  readonly currency = 'ETB' as const;
  private constructor(public readonly amount: Decimal) {}

  static fromDecimal(d: Decimal | string | number): Money {
    const input = typeof d === 'number' ? String(d) : d;
    const dec = new Decimal(input).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    if (dec.isNegative()) throw new Error(`Money amount cannot be negative: ${input}`);
    return new Money(dec);
  }
  static fromETBString(s: string): Money {
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid ETB amount: ${s}`);
    return Money.fromDecimal(s);
  }

  add(o: Money): Money { return new Money(this.amount.plus(o.amount)); }

  sub(o: Money): Money {
    const result = this.amount.minus(o.amount);
    if (result.isNegative()) {
      throw new Error(`Money subtraction would be negative: ${this.toString()} - ${o.toString()}`);
    }
    return new Money(result);
  }

  subOrZero(o: Money): Money { return new Money(Decimal.max(0, this.amount.minus(o.amount))); }
  mul(n: number | Decimal): Money {

    return new Money(this.amount.mul(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  div(n: number | Decimal): Money { return new Money(this.amount.div(n).toDecimalPlaces(2)); }
  pct(p: number): Money { return this.mul(p).div(100); }
  gte(o: Money): boolean { return this.amount.gte(o.amount); }
  gt(o: Money): boolean { return this.amount.gt(o.amount); }
  lte(o: Money): boolean { return this.amount.lte(o.amount); }
  lt(o: Money): boolean { return this.amount.lt(o.amount); }
  eq(o: Money): boolean { return this.amount.eq(o.amount); }
  isPositive(): boolean { return this.amount.gt(0); }
  isZero(): boolean { return this.amount.eq(0); }
  toString(): string { return this.amount.toFixed(2); }
  toJSON(): string { return this.toString(); }
  toNumber(): number { return this.amount.toNumber(); }
}

export function computeSubsidy(price: Money, pct: number): Money {
  return price.pct(pct);
}

export function computeEmployeeShare(price: Money, subsidyPct: number): Money {
  return price.sub(computeSubsidy(price, subsidyPct));
}

export function proratedRideValue(planPrice: Money, ridesIncluded: number, routeFare: Money): Money {
  if (ridesIncluded <= 0) return routeFare;
  return planPrice.div(ridesIncluded);
}
