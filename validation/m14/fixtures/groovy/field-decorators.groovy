package com.acme.groovy

class Widget {

    @Column(name = "widget_name")
    String name

    @Deprecated
    String legacyKey
}
