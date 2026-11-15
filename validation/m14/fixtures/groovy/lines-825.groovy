package com.acme.lines

import com.acme.lines.Marker

interface Marker {
    void use()
}

interface Second {
    void more()
}

class Plain {
    void use() { }
    void more() { }
}

@Deprecated
class Wrapped extends Plain
        implements Marker, Second {

    @Deprecated
    String label

    @Deprecated
    void use() {
        def m = this.label
        services
                .build(m)
                .configure(m)
    }
}
