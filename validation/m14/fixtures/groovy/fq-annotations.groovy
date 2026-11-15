package com.acme.groovy

interface Base {
    def render()
}

@org.springframework.stereotype.Service
class FqService extends Base {

    @Override
    def render() { }

    @org.springframework.transaction.annotation.Transactional
    def save() { }
}
