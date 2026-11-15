interface Shape {
  id: number
  name: Foo
}

class Bar {
  prop: Foo = new Foo()

  method(param: Foo): Baz {
    const local: Map<String, Foo> | null = null
    const z = param as Baz
    if (param instanceof Qux) {
      return local!
    }
    return local!
  }
}
