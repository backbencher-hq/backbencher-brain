// #841 round 8 — Groovy's NUMERIC SUFFIXES.
//
// Java's `decimal_integer_literal` allows only `l`/`L`; Groovy allows `l L g G
// i I d D f F` on an integer, so `5_000_000G` was an ERROR and recovery took the
// enclosing class with it. On a DECIMAL only `g G d D f F` are legal — `1.25l`
// and `1.25i` are refused by the language itself, and are refused here too.
//
// The two sets are measured, not guessed: every suffix was compiled by real
// Groovy 3.0.24 before being added.
class NumericSuffixes841 {

    def bigInteger() {
        return 5_000_000G
    }

    def longForm() {
        return 5_000_000L
    }

    def bigDecimal() {
        return 1.25G
    }

    def doubleForm() {
        return 1.25d
    }

    def floatForm() {
        return 1.25f
    }
}
