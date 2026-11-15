// Field-invocation fixture — `self.blockProp(arg)`, a CALL the lane did not publish.
//
// The `calls` producer for a bare identifier callee (`dispatch_once(...)`)
// needs `call_expression > identifier`. A callee reached through a FIELD has
// no such child — `self.downloadProgressBlock(object)` is
// `call_expression > field_expression` — so before this wave the shape
// produced NO `calls` edge at all, while the SAME `field_expression` still
// produced a `uses` row. The call was invisible.
//
// Measured on the router's own 322 admitted files through production
// `parseFile` before the branch was written
// (script/m60/objc-call-shape-probe.ts):
//
//   identifier        3615 sites / 133 files -> 2277 edges after per-file dedup
//   field_expression   823 sites /  27 files ->    0 edges
//
// 715 of the 823 are Expecta matcher invocations reached through dot syntax
// (`expectation.equal(x)`, `beNil`, `beTruthy`); the rest are block
// properties invoked for effect. 44 distinct callee names, 26 of the sites
// naming a property THIS file declares.
//
//   - expectRelationships: `calls` from each invoking method to the FIELD name,
//     carrying meta.isFieldInvocation true and meta.reasonCode
//     `field-callee-kind-not-determined` (its own code; NOT the C branch's
//     `callee-not-resolved-in-unit`)
//   - expectRelationships: BOTH labels survive on the same node — the `uses`
//     row (isFieldRead) and the `calls` row (isFieldInvocation) are different
//     facts about `self.progressHandler(1)`: it loads a real declared property
//     AND invokes it. The two metadata flags are what tell them apart.
//   - forbidRelationships: no `calls` for a field that is only ASSIGNED
//     (`self.progressHandler = ^{...}`) or only READ (`self.loopCount`) — a
//     field access with no argument list is not a call
//   - forbidRelationships: a bare-identifier callee keeps `isCFunctionCall`
//     and a message send keeps `isMessageExpression`; neither may be
//     re-tagged `isFieldInvocation`
//   - expectRelationships: a nested field callee names the INNERMOST field
//     (`self.sink.onTap(1)` -> `onTap`), the same way the `uses` row names it

#import <Foundation/Foundation.h>

@interface FieldCallSink : NSObject
@property (nonatomic, copy) void (^onTap)(NSUInteger n);
@end

@implementation FieldCallSink
@end

@interface FieldCallDemo : NSObject
@property (nonatomic, copy) void (^progressHandler)(NSUInteger done);
@property (nonatomic, strong) FieldCallSink *sink;
@property (nonatomic, assign) NSUInteger loopCount;
- (void)start;
- (void)peek;
- (void)chain;
- (void)others;
@end

@implementation FieldCallDemo

- (void)start {
    self.progressHandler = ^(NSUInteger done) { (void)done; };
    self.progressHandler(3);
}

- (void)peek {
    NSUInteger seen = self.loopCount;
    (void)seen;
}

// `self.sink.onTap(1)` — the callee expression is a field_expression CHAIN, and
// the name a consumer can resolve is the innermost field.
- (void)chain {
    self.sink.onTap(1);
}

// The two producers this branch must NOT touch.
- (void)others {
    dispatch_async(dispatch_get_main_queue(), ^{ (void)self; });
    [self peek];
}

@end