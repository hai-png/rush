// Money — integer cents (1 ETB = 100 cents). No Decimal.js, no floats.
export class Money {
  private constructor(public readonly cents: number) {
    if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  }

  static fromCents(cents: number): Money {
    return new Money(cents);
  }
  static fromETB(etb: number): Money {
    return new Money(Math.round(etb * 100));
  }
  static fromETBString(s: string | null | undefined): Money | undefined {
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isFinite(n)) return undefined;
    return Money.fromETB(n);
  }
  static ZERO = new Money(0);

  add(other: Money): Money { return new Money(this.cents + other.cents); }
  sub(other: Money): Money { return new Money(this.cents - other.cents); }
  eq(other: Money): boolean { return this.cents === other.cents; }
  gt(other: Money): boolean { return this.cents > other.cents; }
  gte(other: Money): boolean { return this.cents >= other.cents; }
  isPositive(): boolean { return this.cents > 0; }
  isZero(): boolean { return this.cents === 0; }

  toETB(): number { return this.cents / 100; }
  toString(): string { return `${(this.cents / 100).toFixed(2)} ETB`; }
  toDecimalString(): string { return (this.cents / 100).toFixed(2); }
}
