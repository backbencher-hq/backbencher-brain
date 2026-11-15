// OC-ONT-8 fixture — a method ATTRIBUTE is not part of the selector.
//
// `- (instancetype)initWithConfig:(id)config NS_DESIGNATED_INITIALIZER;` is one
// declaration of the selector `initWithConfig:`. `NS_DESIGNATED_INITIALIZER` is Apple's
// macro for `__attribute__((objc_designated_initializer))` and is not part of the name the
// objc runtime registers or that a message send can spell.
//
// The pinned grammar puts two of these attributes at the TOP LEVEL of the method node as a
// bare `identifier`, and both leaked into the published name:
//
//   keyword selector  -> identifier "initWithConfig", method_parameter,
//                       identifier "NS_DESIGNATED_INITIALIZER"
//                       => published `initWithConfig:NS_DESIGNATED_INITIALIZER`
//   zero-arg selector -> identifier "flush", identifier "NS_DESIGNATED_INITIALIZER"
//                       => published `flushNS_DESIGNATED_INITIALIZER`
//
// Measured on the pinned corpus (322 admitted files, 2,891 method nodes): 79 nodes in 29
// files, 30 distinct polluted selector names — `NS_REFINED_FOR_SWIFT` 62,
// `NS_DESIGNATED_INITIALIZER` 15, `NS_SWIFT_NOTHROW` 2. Each polluted name loses the real
// symbol, so every send to the real selector stops resolving to it and `overrides` can
// never match it against a superclass's clean selector.
//
// The rule is POSITIONAL, not a list of attribute names: a selector keyword always owns
// the `method_parameter` that follows it, so with parameters every leftover top-level
// identifier is an attribute, and with none the first leftover is the zero-argument
// selector. So a macro nobody has heard of cannot leak, and a selector spelled like a
// macro cannot be dropped.
//      - expectSymbols: the FOUR real selectors, named exactly
//      - forbidSymbols: the four polluted spellings
//      - the message send in the @implementation must name the CLEAN selector, so the
//        send and the declaration agree and the symbol resolves

#import <Foundation/Foundation.h>

@interface Store : NSObject
// A keyword selector followed by a trailing attribute identifier.
- (instancetype)initWithConfig:(NSDictionary *)config NS_DESIGNATED_INITIALIZER;
// A keyword selector followed by a different attribute identifier.
- (void)flushPending:(NSUInteger)count NS_REFINED_FOR_SWIFT;
// A ZERO-ARGUMENT selector followed by a trailing attribute identifier.
- (void)purge NS_DESIGNATED_INITIALIZER;
// The two attribute spellings the grammar already gave their own node type, which must
// keep working unchanged — this half is what the availability-attribute mutant covers.
- (void)cancel NS_UNAVAILABLE;
- (void)compact API_AVAILABLE(ios(9.0));
// An ordinary declaration, to prove the ordinary case is untouched.
- (NSString *)describe;
@end

@implementation Store
- (instancetype)initWithConfig:(NSDictionary *)config {
    NSNumber *limit = config[@"limit"];
    self.pending = [limit unsignedIntegerValue];
    return self;
}
- (void)flushPending:(NSUInteger)count {
    [self purge];
}
- (void)purge {
    self.pending = 0;
}
- (void)cancel {
}
- (void)compact {
}
- (NSString *)describe {
    return [NSString stringWithFormat:@"pending=%lu", (unsigned long)self.pending];
}
@end

// --- the two `overrides` confidence branches, which OC-ONT-7 must code differently ----
// `Store` is declared in THIS file, so a subclass redeclaring one of its selectors is a
// VERIFIED override at 0.95: the base and the selector are both in hand.
@interface LoudStore : Store
- (void)purge;
@end

@implementation LoudStore
- (void)purge {
}
@end

// `NSMutableArray` is declared in another translation unit, so the same declaration shape
// is a first-parent GUESS at 0.5 — below the patterns.ts 0.7 threshold, and declared as
// such rather than published as a fact. Two codes, two claims.
@interface RemoteStore : NSMutableArray
- (void)removeAllObjects;
@end