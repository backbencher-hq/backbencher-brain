// DERIV_EXPORTS_OBJC — OBJCD9: an export MARKER is a declaration, and a
// prototype is a function.
//
// WHY THIS FIXTURE EXISTS. Two defects, one measurement each, both found by
// walking the admitted universe rather than by reading the source:
//
//   1. `exports` was a GAP. The lane documented `exports` as
//      "all symbols exported with visibility: public" on the SIDE channel and
//      never constructed the relationship, which left `classifyEvidenceTier`'s
//      `type === "exports"` branch dead code in this lane. The census
//      (script/m60/objc-exports-census.ts, 322 files, 211,430 nodes) counted the
//      construct: FOUNDATION_EXPORT on 98 declarations in 18 files, `extern` on
//      1, attribute_specifier 0, visibility_specification 1, export-named
//      preproc_def 0 of 24. The marker is a NAMED `storage_class_specifier` the
//      grammar emits, so the edge is declaration-backed.
//
//   2. A file-scope function PROTOTYPE published no symbol, or published as
//      `variable`. Measured (script/m60/objc-prototype-defect.ts and the label
//      probe): of the corpus's 23 file-scope prototypes, 8 published nothing and
//      13 published `variable` — 21 wrong or absent, and the 8 absent include 7
//      of the 98 marker-carrying declarations, so the `exports` edge would have
//      named symbols the index does not hold.
//
// WHY THE SHAPE IS `<file scope> -> <name>` AND NOT THE C SIBLING'S
// `<name> -> <marker>`. The C analyzer publishes `exports curl_strequal ->
// CURL_EXTERN`, so the marker's name is the TARGET and can never resolve to a
// symbol. go (`packageName -> name`), python (`moduleName -> name`), typescript
// (`moduleLeafName -> name`) and powershell (`top().scope -> name`) all put the
// container on the source half and the NAME on the target half, so both ends
// resolve. Objective-C has no module keyword, so the container is the
// translation unit — the same `root` this lane already uses for its file-scope
// `references` edges — and `metadata.fileLevel` is the key the store reads to
// name the importing FILE on such a row (the same key c and powershell set).
//
// WHY THERE IS NO PIN FOR "EVERYTHING IN A HEADER IS PUBLIC". That is an
// umbrella-header + module-map CONVENTION, not a declaration, and 162 of 169
// corpus headers declare a class. No edge is manufactured for it; it is declared
// as a limitation with the count attached.
//
// SUPERSEDED IN PART, 2026-10-15 (OC-ONT-8, owner ruling). The header above
// describes the family at OBJCD9's scope: MARKER-bearing declarations only, whole
// family at `evidenceClass: import_based`. The later OC-ONT wave specced the same
// family as EXTERNAL LINKAGE (C99 6.2.2p5) with the fleet vocabulary
// (`relationshipType: "module_export"`, `isExport`, `fileLevel`) and the fleet
// tier, and objc/linkage-and-imports was red on exactly that. The two specs are
// mutually exclusive on two axes — a class cannot be both a required export and a
// forbidden one, and the same `extern` declaration cannot be both `import_based`
// and `structural` — so this was measured, put to the owner, and ruled: the
// external-linkage scope stands. Measured support for that ruling: the F5 oracle's
// own export site derivation is the external-linkage one (script/m60/
// objc-construct-site-probe.ts: 338 file-scope external-linkage construct sites
// against 98 edges emitted by the marker-only rule), and c/cpp/powershell classify
// `exports` as `structural`. Three assertions in the expectation file changed and
// are marked at their own line; every marker value, the four marker-bearing
// declarator shapes, and the refusals (phantom, `NS_ASSUME_NONNULL_BEGIN`, the
// marker names themselves, `ExportedConst`) are untouched.
//
// All four corpus declarator shapes carrying a marker are here: bare identifier
// (a constant), pointer_declarator (pointer-returning prototype), bare
// function_declarator (void-returning prototype), and `extern` on a constant.
// The fourth is the UNTERMINATED stacked-macro shape from
// AFURLRequestSerialization.h — `NS_ASSUME_NONNULL_BEGIN` above a marker
// declaration, which the grammar closes with a MISSING `;`. Its declarator is a
// phantom, so it must publish no symbol AND no export edge.

@interface Exported;

@interface Exported : NSObject
- (void)touch;
@end

FOUNDATION_EXPORT ExportedConst ExportedConstValue;
FOUNDATION_EXPORT NSString *ExportedPrototype(NSString *argument);
FOUNDATION_EXPORT void ExportedVoidPrototype(Exported *owner);
extern ExportedConst ExportedExternConst;

// The stacked-macro shape: the grammar closes this declaration with a MISSING
// `;` and its identifier is a phantom, so it declares nothing and exports
// nothing. (Same shape as
// afnetworking/AFNetworking/AFURLRequestSerialization.h:31.)
NS_ASSUME_NONNULL_BEGIN
FOUNDATION_EXPORT ExportedConst ExportedPhantom;

@implementation Exported
- (void)touch {
    NSLog(@"%@", ExportedConstValue);
}
@end