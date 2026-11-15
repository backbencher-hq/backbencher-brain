package com.acme.pipeline

class Guard {
    def probe() {
        return user?.account?.owner?.label
    }
}
