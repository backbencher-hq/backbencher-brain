class Point {
  int x
  int y
}

class ShapeSvc {
  def describe(Object o) {
    if (o instanceof Point(int x, int y)) {
      return x
    }
    if (o instanceof String s) {
      return s.length()
    }
    return 0
  }

  def pick(Object o) {
    switch (o) {
      case Point(int x, int y):
        return x
      default:
        return 0
    }
  }

  // QUALIFIED-pattern coverage. The lane's type-reference collector records a
  // name only when it is QUALIFIED (`if (!t.name.includes(".")) continue` in
  // the analyzer's emit), so the bare `Point`/`String` patterns above exercise
  // the positions but cannot produce an edge at all - the CHANNEL stays
  // unobserved. These two methods write the same two pattern positions with a
  // qualified receiver type, the only shape the analyzer can and does report.
  def describeQualified(Object o) {
    if (o instanceof acme.shapes.Circle c) {
      return 1
    }
    if (o instanceof acme.shapes.Rect r) {
      return 2
    }
    return 0
  }

  def pickQualified(Object o) {
    switch (o) {
      case acme.shapes.Square s:
        return 3
      default:
        return 0
    }
  }
}
