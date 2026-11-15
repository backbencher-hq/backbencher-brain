package com.acme.groovy

@Service
class PlainService {

    @Transactional(readOnly = true)
    def save() { }

    @javax.annotation.PostConstruct
    def init() { }

    @Column(name = "id")
    String id
}
