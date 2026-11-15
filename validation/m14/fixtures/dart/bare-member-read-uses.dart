// M49 #752 (CONV-DT-1) fixture — BARE identifier member reads.
// Pre-fix contract: the selector branch only saw DOTTED reads (`this.count`,
// `obj.count`), so a plain `return count;` on a declared field emitted
// NOTHING (probe-confirmed live: uses edges on x = 0). This pins the fix and
// its two gates: GATE A — the name must resolve to a DECLARED MEMBER of the
// enclosing type; GATE B (CGD15) — a name the CURRENT FUNCTION binds locally
// is not a member read.
class Store {
  int count = 0;
  int total = 0;

  void zero() {
    count = 0;
  }

  int bare() {
    return count;
  }

  int dotted() {
    return this.count;
  }

  int shadowed() {
    int count = 5;
    return count;
  }

  int chained() {
    return count + total;
  }
}
