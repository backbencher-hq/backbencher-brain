package com.acme.pipeline

class Notifier {
    String template(user, count) {
        return "Hello ${user.name}, you have ${count} items"
    }
}
