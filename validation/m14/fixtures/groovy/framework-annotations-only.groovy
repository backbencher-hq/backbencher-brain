package com.acme.groovy

// NO spring imports - fully-qualified annotations only.

@org.springframework.stereotype.Controller
class GroovyController {

    @org.springframework.transaction.annotation.Transactional
    def list() { }
}
