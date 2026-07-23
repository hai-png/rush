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
    // DB-051: avoid floating-point precision loss. Parse the string directly
    // into integer cents by splitting on '.' rather than going through
    // Number(s) * 100 (which can introduce binary-float rounding errors for
    // values like "0.1" or large amounts).
    const trimmed = s.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
    const negative = trimmed.startsWith('-');
    const abs = negative ? trimmed.slice(1) : trimmed;
    const [whole, frac = ''] = abs.split('.');
    if (frac.length > 2) return undefined; // sub-cent precision not allowed
    const paddedFrac = (frac + '00').slice(0, 2);
    const cents = parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
    return new Money(negative ? -cents : cents);
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
