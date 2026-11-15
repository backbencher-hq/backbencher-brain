package com.acme.scala

class AbstractRenderer {
    def common(): Unit = {}
}

class ShapeRenderer extends AbstractRenderer {
    override def draw(): Unit = {}
}
