package com.example.groovy

interface Formatter {
    String format(String value)
}

class GroovyService implements Formatter {
    String prefix

    GroovyService(String prefix) {
        this.prefix = prefix
    }

    @Override
    String format(String value) {
        return "${prefix}:${value}"
    }

    String find(String id) {
        return format(id)
    }
}
