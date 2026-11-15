class Foo {
  static int bar(int x) {
    return x
  }
}

class RefSvc {
  def run(list) {
    return list.stream().map(Foo::bar)
  }
}
