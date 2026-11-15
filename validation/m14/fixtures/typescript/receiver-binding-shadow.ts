function firstAtByteZero() {
  const receiver = new Other()
  receiver.run()
}

class Outer {
  run() {}
}
class Other {
  run() {}
}

const receiver = new Outer()

function moduleReceiver() {
  receiver.run()
}

function unknownParameter(receiver) {
  receiver.run()
}

function unknownLocal() {
  const receiver = JSON.parse("{}")
  receiver.run()
}

function classNamesake(Outer) {
  Outer.run()
}

function blockScopes() {
  const receiver = new Outer()
  {
    const receiver = new Other()
    receiver.run()
  }
  receiver.run()
}

function hoistedVar() {
  {
    var receiver = new Other()
  }
  receiver.run()
}
