class Rebuilt {
  static mapWith = 'neo4j'

  Rebuilt(String name) {
    super()
    this.name = name
  }

  List convert(List items) {
    def out = []
    for (item in items) {
      out.add(item as String)
    }
    return out
  }

  def tagged(List values, Closure fn) {
    values.each { String n -> fn(n) }
  }

  def spreadCall(List args) {
    convert(*args)
    if (args.isEmpty()) throw new IllegalStateException('empty')
  }
}
