// part_of fixture — `#import` / `#include` as FILE INCLUSION, not a name import.
//
// Objective-C has two dependency declarations and they are different constructs:
//
//   #import <Foundation/Foundation.h>     preproc_include    TEXTUAL INCLUSION
//   #import "LocalThing.h"                preproc_include    TEXTUAL INCLUSION
//   #include <stdlib.h>                   preproc_include    TEXTUAL INCLUSION
//   @import WidgetKit;                    module_import      a NAMED clang module
//
// The first three splice the header's text into THIS translation unit: the header has
// no compilation unit of its own, its declarations enter this file's scope, and it
// cannot be compiled alone. That is the `part_of` contract (src/ast/types.ts:PartOf).
// A clang module is the opposite — a separately compiled unit imported by name — so it
// must NOT produce a part_of row (the forbid block pins that).
//
// The edge already existed in two other shapes and both stay: `imports` (this file
// depends on that header — the row src/lsp answers "what does this file depend on"
// with) and `references` (the header path is MENTIONED). Neither says the header's
// text became part of this unit, which is why the third label is additive and nothing
// is relabelled away.
//
// TARGET SHAPE. A path target is resolved by name against the symbol table, so it
// resolves zero rows. The target here is the name a reader can actually look up: the
// framework/module for an angle include (first path segment) and the header stem for a
// quoted project header (the type the header declares). The written path is preserved
// in metadata.partPath. `partRole: "library"` is mandatory on every row and says this
// file is the including library side of the pair.
//
// EXPECT: one part_of row per preproc_include above, from root, targets
// Foundation / LocalThing / stdlib, each carrying partPath, partRole library,
// isFileInclusion true, fileLevel true, evidenceClass import_based, at 1.0.
// FORBID: a part_of whose target is a path (the resolved-0-rows failure), a part_of
// for the clang module import, and a part_of sourced from anything but the file scope.

#import <Foundation/Foundation.h>
#import "LocalThing.h"
#include <stdlib.h>
@import WidgetKit;

@interface PartOfDemo : NSObject
- (void)run;
@end

@implementation PartOfDemo
- (void)run
{
    NSMutableArray *items = [NSMutableArray array];
    [items addObject:@"done"];
}
@end
