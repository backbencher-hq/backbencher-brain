// Services.js — CommonJS: require, module.exports, prototype inheritance.
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")

function FileLogger(file) {
  this.file = file
}

FileLogger.prototype.log = function (message) {
  return fs.appendFileSync(this.file, message + "\n")
}

function CompositeLogger(loggers) {
  this.loggers = loggers
}

CompositeLogger.prototype.log = function (message) {
  for (const logger of this.loggers) {
    logger.log(message)
  }
}

function Service(repo) {
  this.repo = repo
}

Service.prototype.get = function (id) {
  return this.repo.get(id)
}

Service.prototype.set = function (id, value) {
  this.repo.set(id, value)
}

module.exports = { FileLogger, CompositeLogger, Service }
