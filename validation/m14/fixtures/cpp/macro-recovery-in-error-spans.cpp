// M65 — MACRO RECOVERY: a `#define` the grammar swallowed is still a DECLARATION.
//
// WHAT THIS PINS, AND WHY NO EXISTING FIXTURE COULD.
//
// The analyzer publishes a `#define` from a `preproc_def` / `preproc_function_def` node
// (`src/ast/real-cpp-analyzer.ts:3317`). That branch is correct — it published 1,277 macro symbols
// over a two-repo corpus. What it cannot do is mint a symbol for a node the grammar NEVER CREATED,
// and on real single-header libraries it does not create one for every directive.
//
//   MEASURED (fmt 10.2.1 + nlohmann-json v3.11.3, 524 files, through the production entry):
//     `#define` lines in source .................. 3,483
//     `preproc_def` / `preproc_function_def` .... 2,939
//     macros the grammar never produced ..........   544   (15.6%)
//     of those, in a file with >=1 ERROR node ....   543
//     `calls` rows targeting one of those ........ 9,004   <- 67% of all genuinely-unresolved targets
//
// The worst case is doctest.h: 672 `#define` lines, 131 `preproc_*` nodes, 2,627 ERROR nodes, and a
// single top-level ERROR span covering the WHOLE FILE (1-7107). `CHECK` alone is 6,734 unresolved
// `calls` rows corpus-wide.
//
// THIS FIXTURE IS REAL CODE, NOT A CONSTRUCTION. Everything below the line marked
// "--- ORIGINAL FILE CONTENT ---" is nlohmann/json's `include/nlohmann/detail/abi_macros.hpp`
// (v3.11.3) reproduced UNMODIFIED — not byte-for-byte as a whole, because this note precedes it,
// but the library content itself is untouched. It is the SMALLEST file in the corpus with a
// directive inside an ERROR span, selected by walking every candidate file and measuring, not
// guessed. In the ORIGINAL file the fork produces **21** `preproc_*` nodes for its 22 defines:
// exactly one short. The missing one is `NLOHMANN_JSON_NAMESPACE_END`, at ORIGINAL line 97 (line
// 145 in this copy, offset by this note), because the grammar's ERROR region covers the last three
// lines of the file.
//
// THE CONTROL IS THE OTHER 21. They all parse and publish through the EXISTING branch, so an
// implementation that deleted that branch, or that minted a symbol for every ALL-CAPS name it saw,
// fails here. The load-bearing assertions are:
//   * `expectSymbols` names `NLOHMANN_JSON_NAMESPACE_END` with kind `constant` — the recovered symbol,
//     pinned by KIND and not only by name, so a phantom of another kind does not satisfy it;
//   * `expectSymbolCount ... equals: 1` for it — the only form that fails when the same name is
//     minted twice, which is the collision the branch's own guard prevents;
//   * `NLOHMANN_JSON_VERSION_MAJOR` (kind `constant`, a normal object-like define outside the ERROR
//     region) must still be published — the direction that costs real symbols;
//   * `NLOHMANN_JSON_NAMESPACE_BEGIN` — ALSO published, and it is the sharpest control in the file,
//     because it sits immediately ABOVE the ERROR region and is itself a multi-line define. The
//     grammar classifies it OBJECT-LIKE (no parameter list), so the correct kind is `constant`; an
//     early draft of this fixture claimed `macro` and the analyzer was RIGHT and the fixture wrong.
//     A recovery arm that swept up every ALL-CAPS name in the file's neighbourhood would mint it
//     under a second, conflicting kind and this row catches that.
//
// NOTE ON THE UPSTREAM-FIX CASE. If the vendored fork is ever replaced by one that parses this
// shape cleanly, a `preproc_function_def` node appears for that define and the ORDINARY branch
// publishes the same symbol, so name and kind are unchanged and these assertions still hold — only
// the recovery arm stops being exercised. The mutant
// `cpp/macro-recovery-in-error-spans` is what proves the arm is live today.
//
// WHY NOT A HAND-WRITTEN MINIMAL FILE. The first attempt at this fixture wrote a synthetic
// macro-decorated class to force an ERROR region; the shape did not reproduce (ERROR spans appeared,
// but no `#define` fell inside one), so the fixture would have pinned nothing while reading as if it
// did. A fixture that cannot fail is worse than no fixture — it is the class this lane's own
// `d6-blind-spot` and `retired: true` mutant records are about.

// --- ORIGINAL FILE CONTENT (nlohmann/json v3.11.3 include/nlohmann/detail/abi_macros.hpp) ---

//     __ _____ _____ _____
//  __|  |   __|     |   | |  JSON for Modern C++
// |  |  |__   |  |  | | | |  version 3.11.3
// |_____|_____|_____|_|___|  https://github.com/nlohmann/json
//
// SPDX-FileCopyrightText: 2013-2023 Niels Lohmann <https://nlohmann.me>
// SPDX-License-Identifier: MIT

#pragma once

// This file contains all macro definitions affecting or depending on the ABI

#ifndef JSON_SKIP_LIBRARY_VERSION_CHECK
    #if defined(NLOHMANN_JSON_VERSION_MAJOR) && defined(NLOHMANN_JSON_VERSION_MINOR) && defined(NLOHMANN_JSON_VERSION_PATCH)
        #if NLOHMANN_JSON_VERSION_MAJOR != 3 || NLOHMANN_JSON_VERSION_MINOR != 11 || NLOHMANN_JSON_VERSION_PATCH != 3
            #warning "Already included a different version of the library!"
        #endif
    #endif
#endif

#define NLOHMANN_JSON_VERSION_MAJOR 3   // NOLINT(modernize-macro-to-enum)
#define NLOHMANN_JSON_VERSION_MINOR 11  // NOLINT(modernize-macro-to-enum)
#define NLOHMANN_JSON_VERSION_PATCH 3   // NOLINT(modernize-macro-to-enum)

#ifndef JSON_DIAGNOSTICS
    #define JSON_DIAGNOSTICS 0
#endif

#ifndef JSON_USE_LEGACY_DISCARDED_VALUE_COMPARISON
    #define JSON_USE_LEGACY_DISCARDED_VALUE_COMPARISON 0
#endif

#if JSON_DIAGNOSTICS
    #define NLOHMANN_JSON_ABI_TAG_DIAGNOSTICS _diag
#else
    #define NLOHMANN_JSON_ABI_TAG_DIAGNOSTICS
#endif

#if JSON_USE_LEGACY_DISCARDED_VALUE_COMPARISON
    #define NLOHMANN_JSON_ABI_TAG_LEGACY_DISCARDED_VALUE_COMPARISON _ldvcmp
#else
    #define NLOHMANN_JSON_ABI_TAG_LEGACY_DISCARDED_VALUE_COMPARISON
#endif

#ifndef NLOHMANN_JSON_NAMESPACE_NO_VERSION
    #define NLOHMANN_JSON_NAMESPACE_NO_VERSION 0
#endif

// Construct the namespace ABI tags component
#define NLOHMANN_JSON_ABI_TAGS_CONCAT_EX(a, b) json_abi ## a ## b
#define NLOHMANN_JSON_ABI_TAGS_CONCAT(a, b) \
    NLOHMANN_JSON_ABI_TAGS_CONCAT_EX(a, b)

#define NLOHMANN_JSON_ABI_TAGS                                       \
    NLOHMANN_JSON_ABI_TAGS_CONCAT(                                   \
            NLOHMANN_JSON_ABI_TAG_DIAGNOSTICS,                       \
            NLOHMANN_JSON_ABI_TAG_LEGACY_DISCARDED_VALUE_COMPARISON)

// Construct the namespace version component
#define NLOHMANN_JSON_NAMESPACE_VERSION_CONCAT_EX(major, minor, patch) \
    _v ## major ## _ ## minor ## _ ## patch
#define NLOHMANN_JSON_NAMESPACE_VERSION_CONCAT(major, minor, patch) \
    NLOHMANN_JSON_NAMESPACE_VERSION_CONCAT_EX(major, minor, patch)

#if NLOHMANN_JSON_NAMESPACE_NO_VERSION
#define NLOHMANN_JSON_NAMESPACE_VERSION
#else
#define NLOHMANN_JSON_NAMESPACE_VERSION                                 \
    NLOHMANN_JSON_NAMESPACE_VERSION_CONCAT(NLOHMANN_JSON_VERSION_MAJOR, \
                                           NLOHMANN_JSON_VERSION_MINOR, \
                                           NLOHMANN_JSON_VERSION_PATCH)
#endif

// Combine namespace components
#define NLOHMANN_JSON_NAMESPACE_CONCAT_EX(a, b) a ## b
#define NLOHMANN_JSON_NAMESPACE_CONCAT(a, b) \
    NLOHMANN_JSON_NAMESPACE_CONCAT_EX(a, b)

#ifndef NLOHMANN_JSON_NAMESPACE
#define NLOHMANN_JSON_NAMESPACE               \
    nlohmann::NLOHMANN_JSON_NAMESPACE_CONCAT( \
            NLOHMANN_JSON_ABI_TAGS,           \
            NLOHMANN_JSON_NAMESPACE_VERSION)
#endif

#ifndef NLOHMANN_JSON_NAMESPACE_BEGIN
#define NLOHMANN_JSON_NAMESPACE_BEGIN                \
    namespace nlohmann                               \
    {                                                \
    inline namespace NLOHMANN_JSON_NAMESPACE_CONCAT( \
                NLOHMANN_JSON_ABI_TAGS,              \
                NLOHMANN_JSON_NAMESPACE_VERSION)     \
    {
#endif

#ifndef NLOHMANN_JSON_NAMESPACE_END
#define NLOHMANN_JSON_NAMESPACE_END                                     \
    }  /* namespace (inline namespace) NOLINT(readability/namespace) */ \
    }  // namespace nlohmann
#endif