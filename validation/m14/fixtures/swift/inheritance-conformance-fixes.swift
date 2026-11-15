// SWIFTD13-16 regression fixture: protocol inheritance, extension
// conformances, enum conformances + raw-type payload, XCTest/uint
// non-fabrication. Authored during the M37.14 dual-lens pass (#607).

protocol Drawable {
  func draw()
}

protocol Shape: Drawable {}

protocol Resettable {}

class Circle: Shape {
  var radius: Double = 0
}

extension Circle: Resettable, Equatable {
  func draw() {}
  static func == (l: Circle, r: Circle) -> Bool { true }
}

// Class-constraint marker must NOT become an extends target.
protocol ClassConstrained: AnyObject, Resettable {}

enum Status: String, Codable, Sendable {
  case ready = "r"
}

enum Failure: Error {
  case timeout(String)
}

func verify(_ value: Int) {
  XCTAssertEqual(value, 1)
  let big = UInt64(value)
  let q = DispatchQueue(label: "probe")
  print(q, big)
}
