// SW-A: non-self member reads (self and bare members already covered).
// SW-B: enum-case construction (static factories stay calls).
// SW-D: key-path members always read. SW-E: type(of:) is stdlib.
// SW-F: projected values ($count) read the wrapped member.
enum Result {
  case success(Int)
  case failure(Error)
}

class Store {
  var items: [Int] = []
  var count: Int = 0
  static let shared = Store()
  static func create() -> Store { Store() }
  func fetch(_ k: Int) -> Int { items[k] }
}

class C {
  var store = Store()
  func useAll(_ o: Obj, _ xs: [Int]) {    let a = store.items.count
    let b = o.box.fetch(1)
    let s = Store.shared
    let e = Result.success(1)
    let f = Store.create()
    let g = type(of: store)
    let h = o.items[0]
    let k = users.map(\.name)
    let j = o[keyPath: \.slot]
  }
  func writeOnly(_ o: Obj) {
    o.slot = 1
  }
}

struct V {
  var count = 0
  func bump() {
    let b = $count
  }
}
