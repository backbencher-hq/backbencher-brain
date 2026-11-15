package com.acme.noimport

// Deliberately NO spring/jpa imports: fully-qualified annotations only.
// Framework detection must not depend on import presence.
//
// PINNED-WASM WARNING (see docs/analyzers/review-appendix.md): top-level
// declarations whose annotations carry ARGUMENT lists can be silently
// shredded into prefix_expression nodes when followed by further
// declarations. This fixture therefore keeps argumentized annotations
// inside class bodies (safe) and uses marker annotations at top level.

@jakarta.persistence.Entity
class Widget

@org.springframework.stereotype.Service
@org.springframework.transaction.annotation.Transactional
class OrderService {

    @org.springframework.web.bind.annotation.GetMapping("/orders")
    fun orders(): String = "ok"
}
