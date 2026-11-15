// OC-ONT wave fixture — `imports`, `exports`, and the `[[self alloc] init]` class.
//
// Three behaviours, one file, because they share a shape: a TRANSLATION UNIT's
// boundary. What a unit publishes to the units that import it (`exports`), what
// it depends on (`imports`), and what it constructs from itself.
//
// 1. `imports` — `#import`/`#include` is Objective-C's only dependency
//    declaration. Before this wave the lane published it as `references` +
//    metadata.isObjCImport, so the one reader that answers "what does this
//    module depend on" (the LSP usages file-level section, which filters
//    `relationship_type = 'imports'` with a NULL symbol endpoint on both sides)
//    could never see an Objective-C include. The `references` twin is KEPT: the
//    F5 oracle derives `references` for `preproc_include`, and dropping it would
//    turn 902 audited edges into unexplained false negatives against an oracle
//    this lane cannot edit.
//      - expectRelationships: `imports` for <Foundation/Foundation.h> and
//        "Widget.h", each carrying meta.relationshipType include_dependency,
//        meta.fileLevel true, meta.module and meta.isSystem
//      - the system include must be isSystem:true, the quoted one false
//      - both `imports` AND `references` exist for the same pair
//
// 2. `exports` — a file-scope declaration with EXTERNAL linkage is visible to
//    every translation unit that imports this file (C99 6.2.2p5, which
//    Objective-C inherits verbatim). `static` is the one spelling of "not
//    exported": internal linkage. Measured on the pinned corpus before the fix:
//    50 file-scope function_definitions and 67 file-scope declarations carried
//    `static`, and every one of them was published `visibility: "public"` —
//    asserting an importability the language denies.
//      - expectRelationships: `exports` root -> each external-linkage unit
//      - forbidRelationships: NO export for internalHelper / internalConstant /
//        the internal struct, and NO export for the category label
//      - the superclass name is NOT an export of this file (it is declared
//        elsewhere; `extends` is the fact)
//
// 3. `[[self alloc] init]` — `[self alloc]` allocates an instance of the
//    RECEIVER'S OWN CLASS. The pre-fix code read the receiver's text, so it
//    published `instantiates <method> -> self`: an edge naming the `self`
//    keyword, which no file declares and no consumer can resolve. Measured:
//    24 of 507 instantiates edges (4.7%). The enclosing class is the right
//    target and it is already resolved when this branch runs.
//      - expectRelationships: `instantiates freshSerializer -> Serializer`
//      - forbidRelationships: no instantiates edge whose target is `self`
//      - `[[super alloc] init]` names the SUPERCLASS, resolved from the
//        in-file extends clause

#import <Foundation/Foundation.h>
#import "Widget.h"

FOUNDATION_EXPORT NSInteger const WidgetLimit = 10;
extern NSInteger WidgetSharedCounter;

// Internal linkage: visible only inside this translation unit. C99 6.2.2p5.
static NSInteger internalHelper(NSInteger v) { return v + WidgetLimit; }
static NSInteger internalConstant = 7;

typedef struct WidgetSize {
    NSInteger width;
    NSInteger height;
} WidgetSize;

@interface Serializer : NSObject
- (instancetype)initWithWidth:(NSInteger)width;
@end

@implementation Serializer
- (instancetype)initWithWidth:(NSInteger)width {
    return [[self alloc] init];
}
+ (instancetype)freshSerializer {
    return [[self alloc] initWithWidth:1];
}
- (NSInteger)measure {
    return internalHelper(internalConstant);
}
@end

// The superclass is declared in THIS file, so `[[super alloc] init]` names it.
@interface LoudSerializer : Serializer
- (instancetype)duplicate;
@end

@implementation LoudSerializer
- (instancetype)duplicate {
    return [[super alloc] initWithWidth:2];
}
@end

// A category is not a top-level resolvable unit (OC-B): exporting it as
// "Serializer" would claim the class is defined here.
@interface Serializer (Metrics)
- (NSInteger)audibleMetric;
@end

@implementation Serializer (Metrics)
- (NSInteger)audibleMetric {
    return internalConstant;
}
@end