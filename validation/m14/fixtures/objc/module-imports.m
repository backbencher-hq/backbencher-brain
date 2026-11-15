// Module-import fixture — `@import Module;`, Objective-C's SECOND dependency
// declaration.
//
// The lane read ONE of the language's two dependency forms. `#import "X.h"` /
// `#import <X/X.h>` is a `preproc_include` node and has been published as the
// `imports` + `references` pair since the OC-ONT wave. `@import Module;` is a
// clang module import, a `module_import` node, and it published NOTHING: the
// `preproc_include` branch cannot be widened to cover it, because a module
// import's single named child is a bare `identifier` with no `<>` and no quotes
// to strip.
//
// Measured before the branch was written (script/m60/objc-call-shape-probe.ts,
// the router's own 322 admitted files, read through production `parseFile`):
//
//   #import / #include   preproc_include   904 sites / 322 files -> 902 + 902 edges
//   @import Module;      module_import        6 sites /   6 files ->    0 edges
//
// All six corpus sites are `@import AFNetworking;` in the AFNetworking example
// applications. Six is few; a dependency a consumer cannot see is not less of a
// dependency for being rare.
//
//   - expectRelationships: `imports` root -> WidgetKit and root -> CoreData,
//     each with meta.relationshipType "module_import" (NOT
//     "include_dependency" — a clang module is not a header path), meta.
//     isObjCModuleImport true, meta.fileLevel true, meta.module set
//   - expectRelationships: the `references` twin for the same pair, carrying
//     meta.reasonCode "clang-module-name-not-resolved" — its own code, because
//     the target names a MODULE and nothing here knows whether the build
//     defines one by that name. An `#include`'s row keeps
//     "include-target-not-resolved" (pinned on the line below).
//   - forbidRelationships: no edge of any type whose target is a module name
//     under `exports` — a module is a dependency, never a declaration
//   - forbidSymbols: the module names are MODULES, not classes declared here

#import <Foundation/Foundation.h>
@import WidgetKit;
@import CoreData;

@interface ModuleImportDemo : NSObject
- (NSInteger)rowHeight;
@end

@implementation ModuleImportDemo
- (NSInteger)rowHeight {
    return 44;
}
@end