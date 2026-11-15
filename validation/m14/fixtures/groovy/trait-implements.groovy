package com.acme.pipeline

trait Loggable {
    def log(String msg) { println msg }
}

class Job implements Loggable {
    def run() { log("running") }
}
