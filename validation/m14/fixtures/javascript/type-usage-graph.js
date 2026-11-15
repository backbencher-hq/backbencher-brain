class Bar {
  method(param) {
    if (param instanceof Qux) {
      return null
    }
    return param
  }

  static check(v) {
    return v instanceof Date
  }
}
