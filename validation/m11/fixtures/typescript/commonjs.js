const path = require("node:path")

class Loader {
  load(value) {
    return path.resolve(value)
  }
}

module.exports = { Loader }
