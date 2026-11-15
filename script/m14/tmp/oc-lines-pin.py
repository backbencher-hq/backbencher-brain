#!/usr/bin/env python3
"""script/m14/tmp/oc-lines-pin.py — author the objc lane's M59.A7 line pins.

Each pin below is read off the FIXTURE SOURCE (the line the name is written on), not
off a run: the expectations are authored before the analyzer is asked. The near-miss
forbids name the line the PRE-FIX plausible spelling would have claimed — the
enclosing declaration, or the container — because before this round the lane emitted
NO line at all and "no line" is the weaker half of the defect the cell had to be
reworded for (#930): a line that names the wrong place is worse than an absent one.
"""
import json

PINS = {
    "edges-and-patterns": {
        "expect": [
            ({"type": "references", "source": "root", "target": "Foundation/Foundation.h",
              "line_number": 9, "note": "M59.A7: the import's own line (the name is the path inside the brackets)"}),
            ({"type": "references", "source": "root", "target": "UIKit/UIKit.h",
              "line_number": 10, "note": "M59.A7: second import, its own line"}),
            ({"type": "extends", "source": "Renderable", "target": "NSObject",
              "line_number": 12, "note": "M59.A7: `@protocol Renderable <NSObject>` — the inherited name's line"}),
            ({"type": "extends", "source": "Animatable", "target": "Renderable",
              "line_number": 16, "note": "M59.A7: protocol inheritance, the declared line"}),
            ({"type": "implements", "source": "UIView", "target": "Animatable",
              "line_number": 20, "note": "M59.A7: category protocol adoption on the category's own line"}),
            ({"type": "extends", "source": "CustomView", "target": "UIView",
              "line_number": 38, "note": "M59.A7: `@interface CustomView : UIView <Renderable>`"}),
            ({"type": "contains", "source": "Renderable", "target": "render",
              "line_number": 13, "note": "M59.A7: the MEMBER's declaration line, not the container's (12)"}),
            ({"type": "contains", "source": "Counter", "target": "_count",
              "line_number": 73, "note": "M59.A7: the ivar's own declaration line inside the braces"}),
            ({"type": "contains", "source": "Counter", "target": "countAll:",
              "line_number": 79, "note": "M59.A7: a METHOD's owner row names its IMPLEMENTATION line — an @interface method DECLARATION is not symbolized in this lane (measured: Counter at 78 owns only _count@73 and countAll:@79; protocols are the exception and are symbolized at their declaration). The forbid below pins the distinction."}),
            ({"type": "instantiates", "source": "render", "target": "UIView",
              "line_number": 43, "note": "M59.A7: the `[UIView alloc]` receiver's line"}),
            ({"type": "calls", "source": "render", "target": "initWithFrame:",
              "line_number": 43, "note": "M59.A7: the message's first keyword sits on 43"}),
            ({"type": "calls", "source": "render", "target": "addSubview:",
              "line_number": 44, "note": "M59.A7: a DIFFERENT site from the nested construction on 43"}),
            ({"type": "calls", "source": "makeWithView:", "target": "addSubview:",
              "line_number": 50, "note": "M59.A7: same selector, second call site — the line distinguishes them"}),
            ({"type": "uses", "source": "applyRoundedCornerRadius:", "target": "layer",
              "line_number": 26, "note": "M59.A7: the read's own site (`[self.layer setCornerRadius:]`), not the method's declaration (25)"}),
            ({"type": "uses", "source": "animate", "target": "superview",
              "line_number": 30, "note": "M59.A7: SC-A read on its assignment line"}),
            ({"type": "calls", "source": "animate", "target": "setHidden:",
              "line_number": 32, "note": "M59.A7: the call inside the `if` body, not the condition's line (31)"}),
            ({"type": "calls", "source": "renderAll", "target": "Log",
              "line_number": 61, "note": "M59.A7: C function call inside the for-in body (the loop header is 60)"}),
        ],
        "forbid": [
            ({"type": "uses", "source": "applyRoundedCornerRadius:", "target": "layer",
              "line_number": 25,
              "comment": "M59.A7 near-miss: 25 is the enclosing DECLARATION (`- (void)applyRoundedCornerRadius:`), not the read site (26) — an edge whose line is its declaration's is not checkable against the source"}),
            ({"type": "calls", "source": "render", "target": "addSubview:",
              "line_number": 43,
              "comment": "M59.A7 near-miss: the construction's line, one above the call's own (44)"}),
            ({"type": "contains", "source": "Counter", "target": "countAll:",
              "line_number": 75,
              "comment": "M59.A7 near-miss: the @interface DECLARATION (`- (NSInteger)countAll:(NSArray *)items;`), not the implementation that owns the row (79) — a line that names the declaration is checkable, but it is not the line this lane means"}),
            ({"type": "contains", "source": "Counter", "target": "countAll:",
              "line_number": 72,
              "comment": "M59.A7 near-miss: the CONTAINER's line (`@interface Counter`)"}),
        ],
    },
    "selector-identity": {
        "expect": [
            ({"type": "overrides", "source": "EvictingCache.overrideable", "target": "StoreCache.overrideable",
              "line_number": 62, "note": "M59.A7: the OVERRIDING member's declaration line (the base's copy is at 51, and this row is written here)"}),
            ({"type": "overrides", "source": "StoreCacheTests.testInitWithNamespace", "target": "SDTestCase.testInitWithNamespace",
              "line_number": 75, "note": "M59.A7: the Pass-3 guess still names a line — the overriding declaration's (75)"}),
            ({"type": "calls", "source": "testInitWithNamespace", "target": "initWithNamespace:diskCacheDirectory:",
              "line_number": 76, "note": "M59.A7: the multi-keyword selector's line is its FIRST keyword's line"}),
            ({"type": "instantiates", "source": "testInitWithNamespace", "target": "StoreCache",
              "line_number": 76, "note": "M59.A7: the receiver's line inside the nested alloc send"}),
            ({"type": "instantiates", "source": "testStore", "target": "StoreCache",
              "line_number": 80, "note": "M59.A7: `[StoreCache new]`"}),
            ({"type": "calls", "source": "testStore", "target": "setValue:forKey:",
              "line_number": 81, "note": "M59.A7: full-selector call site"}),
            ({"type": "calls", "source": "testStore", "target": "storeImage:forKey:",
              "line_number": 82, "note": "M59.A7: the next line, so the two calls cannot share a line by accident"}),
            ({"type": "calls", "source": "initWithNamespace:diskCacheDirectory:", "target": "initWithNamespace:",
              "line_number": 40, "note": "M59.A7: `self = [self initWithNamespace:ns];` — the delegation's own line"}),
            ({"type": "contains", "source": "StoreCache", "target": "storeImage:forKey:",
              "line_number": 49, "note": "M59.A7: the implementation's line (the @interface declaration at 29 is not symbolized — see the forbid)"}),
        ],
        "forbid": [
            ({"type": "overrides", "source": "EvictingCache.overrideable", "target": "StoreCache.overrideable",
              "line_number": 57,
              "comment": "M59.A7 near-miss: the @interface DECLARATION (57), not the overriding implementation (62)"}),
            ({"type": "calls", "source": "testStore", "target": "setValue:forKey:",
              "line_number": 79,
              "comment": "M59.A7 near-miss: the method's own declaration line, one above the call"}),
            ({"type": "contains", "source": "StoreCache", "target": "storeImage:forKey:",
              "line_number": 29,
              "comment": "M59.A7 near-miss: the @interface declaration (29), not the owning implementation (49)"}),
        ],
    },
    "payload-and-complexity": {
        "expect": [
            ({"type": "references", "source": "root", "target": "PaymentGateway.h",
              "line_number": 6, "note": "M59.A7: a QUOTED include names the file inside the quotes"}),
            ({"type": "contains", "source": "BaseService", "target": "initWithName:",
              "line_number": 64, "note": "M59.A7: the IMPLEMENTATION's line (BaseService's @interface declares it at 17 and the declaration is not symbolized)"}),
            ({"type": "contains", "source": "PaymentService", "target": "serviceName",
              "line_number": 21, "note": "M59.A7: property declaration line, not the container's (20)"}),
            ({"type": "contains", "source": "PaymentService", "target": "balance",
              "line_number": 22, "note": "M59.A7: the next property"}),
            ({"type": "contains", "source": "PaymentService", "target": "auditTrail",
              "line_number": 57, "note": "M59.A7: a category member is owned by the EXTENDED class (PaymentService), and the line is the category implementation's"}),
            ({"type": "overrides", "source": "PaymentService.initWithName:", "target": "BaseService.initWithName:",
              "line_number": 29, "note": "M59.A7: verified in-file override — the overriding implementation's line"}),
            ({"type": "uses", "source": "authorizeAmount:", "target": "balance",
              "line_number": 36, "note": "M59.A7: `if (amount > self.balance)` — the read's own line"}),
            ({"type": "calls", "source": "authorizeAmount:", "target": "printf",
              "line_number": 37, "note": "M59.A7: C function call inside the for body"}),
            ({"type": "instantiates", "source": "sharedService", "target": "PaymentService",
              "line_number": 47, "note": "M59.A7: `[[PaymentService alloc] initWithName:]` inside the guard body"}),
        ],
        "forbid": [
            ({"type": "contains", "source": "PaymentService", "target": "serviceName",
              "line_number": 20,
              "comment": "M59.A7 near-miss: the container's line (`@interface PaymentService : BaseService <...>`)"}),
            ({"type": "uses", "source": "authorizeAmount:", "target": "balance",
              "line_number": 34,
              "comment": "M59.A7 near-miss: the method DECLARATION (34), not the read (36)"}),
            ({"type": "contains", "source": "BaseService", "target": "initWithName:",
              "line_number": 17,
              "comment": "M59.A7 near-miss: BaseService's @interface declaration (17), not the owning implementation (64)"}),
            ({"type": "contains", "source": "PaymentService", "target": "auditTrail",
              "line_number": 53,
              "comment": "M59.A7 near-miss: the category's @interface declaration (53), not the category implementation (57)"}),
        ],
    },
}

for fixture, spec in PINS.items():
    path = f"validation/m14/fixtures/objc/{fixture}.expectation.json"
    d = json.load(open(path))
    exp = d.setdefault("expectRelationships", [])
    forb = d.setdefault("forbidRelationships", [])
    # replace any earlier copy of the same (type, source, target) pin so re-running is idempotent
    def keyf(r):
        return (r.get("type"), r.get("source"), r.get("target"))
    def strip_touched(rows, touched):
        return [r for r in rows if keyf(r) not in touched or all(k in r for k in ("line_number", "comment"))]
    touched_expect = {keyf(r) for r, _ in [(a, b) for a, b in [(x, None) for x in spec["expect"]]]}
    # pins are additive: an existing pin for the same triple is REPLACED by the line-carrying one
    for pin in spec["expect"]:
        exp = [r for r in exp if keyf(r) != keyf(pin)]
        exp.append(pin)
    for pin in spec["forbid"]:
        forb = [r for r in forb if keyf(r) != keyf(pin) or "comment" not in r]
        forb.append(pin)
    d["expectRelationships"] = exp
    d["forbidRelationships"] = forb
    json.dump(d, open(path, "w"), indent=2)
    open(path, "a").write("\n")
    print(f"{fixture}: +{len(spec['expect'])} line pins, +{len(spec['forbid'])} near-miss forbids")
