package com.acme.groovy

class AbstractRenderer {
    def common() { }
}

class ShapeRenderer extends AbstractRenderer {
    @Override
    def draw() { }
}
