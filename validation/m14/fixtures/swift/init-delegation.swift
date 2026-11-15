// SW-G: super/self init delegation constructs (dart DT-D parity).
// SW-H: implicit (.a(v)) and Self (Self.a(v)) enum-case construction.
class Base {
  init(_ x: Int) {}
}

class Child: Base {
  override init(_ x: Int) {
    super.init(x)
  }
  convenience init() {
    self.init(0)
  }
}

enum Result {
  case success(Int)
  case failure(Error)
  static func make(_ v: Int) -> Result {
    .success(v)
  }
  func dup() -> Result {
    Self.failure(makeErr())
  }
}
