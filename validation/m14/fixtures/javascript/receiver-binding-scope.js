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

function knownLocal() {
  const receiver = new Other()
  receiver.run()
}

function unknownParameter(receiver) {
  receiver.run()
}

function unknownLocal() {
  const receiver = JSON.parse("{}")
  receiver.run()
}
