// #754 fixture source — authored before analyzer run.
class Store {
  var count = 0
  var total = 0

  func bare() -> Int {
    // bare identifier read MUST emit (pre-fix dropped)
    return count
  }

  func dotted() -> Int {
    // the dotted form already emitted
    return self.count
  }

  func plus() -> Int {
    // two bare reads in one additive expression
    return count + total
  }

  func zero() {
    // write LHS: count is a WRITE — never a read
    count = 0
  }

  func shadowed() -> Int {
    // GATE B (CGD15): a local binds count, so this is not a member read
    let count = 5
    return count
  }

  var computed: Int {
    // a computed property's `let` is a LOCAL (pre-fix it read as a member)
    let local = count
    return local + count
  }
}

extension Store {
  // #754 corpus finding: an `extension` carries its type name under
  // `user_type`, so the shallow lookup left the declaration nameless and
  // EVERY bare read in EVERY extension was silently dropped.
  func extBare() -> Int {
    return total
  }
}

enum Mode {
  case fast
  case slow
}

extension Store {
  static var fast = 0

  var group = 0

  func pick() -> Mode {
    // implicit member expression: `.fast` resolves through an INFERRED base
    // (Mode), so it is not a read of Store.fast
    return .fast
  }

  func label() {
    // `group:` is an ARGUMENT LABEL, not a read of the member `group`
    go(group: 1)
  }

  func go(group: Int) {}
}
