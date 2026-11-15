// CROSS-FILE `overrides` for cpp: the half of the label that had no channel at
// all.
//
// `analyze()` took THREE parameters, so the engine's fourth —
// `AnalyzeContext.overrideCompanion` — never reached this analyzer, and the
// override resolver resolved bases from `classBases`, a per-file map. That is the
// PERL-MR14→MR15 defect verbatim, one step quieter: `override-context.ts` names it
// ("Python's `analyze()` had stopped at three parameters ... The rule was written,
// wired to a channel, shipped, and had never run"), and in cpp's case no rule was
// written yet, so nothing turned red.
//
// Measured cost of the per-file-only answer: 735 `override`-keyword sites in the
// corpus against 185 `overrides` edges emitted — the keyword is the author's own
// assertion and it was read for the `decorators` payload only.
//
// The companion carries owner -> declared METHOD NAMES, with no signatures, and a
// name alone cannot tell an override from C++ name hiding. That is exactly why
// PERL-MR15 measured 75.6% of its companion-based edges to be FALSE and withdrew
// them. So the two are combined rather than either being trusted alone: the
// companion proves the base DECLARES the method, the `override`/`final` keyword
// proves the method OVERRIDES one. Without the keyword, no companion-only edge is
// published — which is what `Silent::probe` below pins.
class ExternalDerived : public ExternalInterface {
public:
    // THE POSITION: a genuine cross-file override, established from the keyword
    // plus cross-file-override-base.cpp's declaration. Without the companion this
    // file emits nothing for ExternalInterface at all, which is the honest
    // per-file answer.
    void step(int times) override;

    // `ExternalInterface::tune(int)` is virtual WITH A BODY, and this redeclares
    // the name with a different parameter type — C++ NAME HIDING, not an
    // override. No `override` keyword, because writing one would not compile:
    // the signature does not match. The companion sees only the name `tune`, so
    // this is indistinguishable from `probe` below and gets the same answer.
    void tune(const char* level);

    // A TRUE cross-file override that is DECLINED. `ExternalInterface::probe`
    // is `virtual void probe(int)` and this matches it exactly, so in real C++
    // this IS an override — but the analyzer does not publish the edge, because
    // a name-only companion cannot tell it from the hide above and the keyword
    // that would settle it is absent.
    //
    // THIS IS A DELIBERATE RECALL LOSS, and it is the honest way round: the two
    // candidate edges — a hide published as an override, or an override
    // declined — are indistinguishable on this evidence, and publishing a false
    // edge poisons bb_graph and bb_impact in a way that declining one does not.
    // The cost is counted rather than argued: see `cpp/override-companion-yield`
    // for the population.
    void probe(int depth);
};

// A derived class whose base is visible in THIS file, so the in-file signature
// check applies and the companion is irrelevant. The control that proves the new
// cross-file path did not replace the old one.
class LocalBase {
public:
    virtual void act(int n) { }
    virtual void hide(int n) { }
};

class LocalDerived : public LocalBase {
public:
    void act(int n) override {}
    // a hide, same name different type, NO keyword: the signature check refuses it
    void hide(const char* s) override {}
};