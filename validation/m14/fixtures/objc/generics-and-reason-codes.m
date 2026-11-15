// OC-ONT-6 / OC-ONT-7 fixture — Objective-C LIGHTWEIGHT GENERICS, and the reason code
// every sub-1.0 relationship owes the honesty contract.
//
// 1. `<...>` IS NOT ALWAYS A PROTOCOL LIST. Objective-C spells three different things
//    with one token sequence, and the pinned grammar emits `parameterized_arguments`
//    for all three:
//
//      @interface Cache <KeyType, ObjectType> : Store <KeyType, ObjectType> <CacheProtocol>
//                 ^^^^^^^^^^^^^^^^^^^^^^^^ type  ^^^^^^^^^^^^^^^^^^ type    ^^^^^^^^^^^ protocols
//                 PARAMETERS of Cache      ARGUMENTS of Store  adopted protocols
//
//    Reading every `parameterized_arguments` as an adoption list published
//    `implements Cache -> KeyType` and `-> ObjectType` — names no file declares as a
//    protocol, because they are this class's own type parameters. Measured over the 322
//    admitted corpus files: 7 such fabricated `implements` edges (11 member slots before
//    per-file dedup), against 100 real protocol lists of which ZERO names a type
//    parameter.
//      - expectRelationships: `implements Cache -> CacheProtocol` and
//        `implements Plain -> NSCopying` and the category's `NSCopying` adoption
//      - forbidRelationships: NO implements edge whose target is KeyType, ObjectType or
//        ValueType — those are type parameters, not protocols
//      - `extends Cache -> Store` still published: the superclass is not affected
//
//    The third position is a class EXTENSION re-declaring the enclosing class's type
//    parameters: `@interface Cache <KeyType, ObjectType> ()`. Same trap, different
//    delimiter — there the list sits BEFORE the `(`.
//      - forbidRelationships: no implements from the extension to KeyType/ObjectType
//
// 2. REASON CODES. Honesty §4.1: a relationship below confidence 1.0 must carry a
//    machine-readable reason code, not only a number. Before this rule the lane shipped
//    18,794 sub-1.0 rows with no code at all — 8,077 `calls`, 9,307 `uses`, 902
//    `references`, 508 `instantiates` — and the lane's own documentation had noticed
//    only the `references` one.
//      - expectRelationships: each of `calls`, `uses`, `references`, `instantiates`
//        carries its own meta.reasonCode
//      - `contains`/`exports`/`extends`/`implements` are at 1.0 and carry NO reasonCode;
//        a code on a 1.0 row would claim doubt where there is none

#import <Foundation/Foundation.h>
#import "CacheProtocol.h"

// A GENERIC class: two type parameters, type arguments passed to a generic superclass,
// and one adopted protocol. All three are `parameterized_arguments`.
@interface Cache <KeyType, ObjectType> : Store <KeyType, ObjectType> <CacheProtocol>
@property (nonatomic, strong) KeyType key;
@property (nonatomic, strong) ObjectType value;
- (ObjectType)valueForKey:(KeyType)key;
@end

// The class extension re-declares the same type parameters in front of the `()`.
@interface Cache <KeyType, ObjectType> ()
@property (nonatomic, assign) NSUInteger hits;
@end

// A generic class that adopts NOTHING. The old rule gave it two protocols.
@interface Box <ValueType> : NSObject
@property (nonatomic, strong) ValueType payload;
@end

// The ordinary shape, which must keep working: no generics anywhere, one protocol.
@interface Plain : NSObject <NSCopying>
- (id)plainValue;
@end

// A CATEGORY's list really is a protocol list, and it sits AFTER the `(` — the mirror
// image of the extension above, so the rule cannot be "a list before the paren" alone.
@interface Plain (Trim) <NSFastEnumeration>
- (NSString *)trimmed;
@end

@implementation Plain
- (id)plainValue {
    Cache *cache = [[Cache alloc] init];
    NSString *text = [NSString stringWithFormat:@"%@/%@", cache.key, cache.value];
    NSInteger width = internalConstant;
    return [text length] > width ? [text copy] : text;
}
- (NSString *)trimmed {
    return [self.plainValue description];
}
@end

@implementation Box
@end

@implementation Cache
- (ObjectType)valueForKey:(KeyType)key {
    NSString *name = [NSString stringWithFormat:@"%@", key];
    if (name.length == 0) {
        NSError *failure = [NSError errorWithDomain:@"Cache" code:1 userInfo:nil];
        return (ObjectType)failure;
    }
    NSMutableDictionary *seen = [[NSMutableDictionary alloc] init];
    seen[name] = @(self.hits);
    dispatch_once(NULL, ^{
        seen[name] = @(self.hits);
    });
    return self.value;
}
@end

// Internal linkage (C99 6.2.2p5): a file global that `uses` can legitimately read.
static NSInteger internalConstant = 7;