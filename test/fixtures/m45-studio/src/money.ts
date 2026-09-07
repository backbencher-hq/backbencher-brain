// Money — an immutable minor-unit value object. All prices, totals, and tax
// amounts in Ledgerline flow through this class so currency mistakes are
// impossible by construction.

export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: string,
  ) {}

  static of(amountMinor: number, currency = "USD"): Money {
    Money.assertIntegral(amountMinor)
    return new Money(amountMinor, currency)
  }

  static zero(currency = "USD"): Money {
    return new Money(0, currency)
  }

  static fromMajor(amountMajor: number, currency = "USD"): Money {
    return Money.of(Math.round(amountMajor * 100), currency)
  }

  add(other: Money): Money {
    Money.assertSameCurrency(this, other)
    return new Money(this.amountMinor + other.amountMinor, this.currency)
  }

  subtract(other: Money): Money {
    Money.assertSameCurrency(this, other)
    return new Money(this.amountMinor - other.amountMinor, this.currency)
  }

  multiply(factor: number): Money {
    return new Money(Math.round(this.amountMinor * factor), this.currency)
  }

  isNegative(): boolean {
    return this.amountMinor < 0
  }

  isZero(): boolean {
    return this.amountMinor === 0
  }

  format(): string {
    return (this.amountMinor / 100).toFixed(2) + " " + this.currency
  }

  private static assertIntegral(amountMinor: number): void {
    if (!Number.isInteger(amountMinor)) {
      throw new RangeError("Money must be constructed in minor units")
    }
  }

  private static assertSameCurrency(a: Money, b: Money): void {
    if (a.currency !== b.currency) {
      throw new RangeError("currency mismatch: " + a.currency + " vs " + b.currency)
    }
  }
}
