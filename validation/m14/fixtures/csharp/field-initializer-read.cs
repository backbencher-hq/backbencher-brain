// csharp/field-initializer-read — a const read in a FIELD INITIALIZER is a `uses`, and the
// declarator's own name is not.
//
// WHAT THIS PINS. CS-D11, and it is an ORACLE defect rather than an analyzer defect — the fourth
// oracle-side one this round (CS-D9, CS-D10, CS-D10b, this), which is itself the finding: the
// truth's blind spots have been the defective party every single time.
//
// The shape, verbatim from the corpus:
//     internal int maxDepth = maxDepthAllowable;
//     ^^^^^^^^ declarator's name      ^^^^^^^^^^^^^^^^^^^ a READ of a declared const
//
// `isEntityName` decided "is this the declarator's own name" by asking `declaratorRole(n)`, which
// answers a different question: "is this identifier in MEMBER SCOPE". The two coincide for the
// declarator's name and diverge for its initializer, so the initializer was classified as the
// declaration publishing itself and dropped. Cost: every const and field read from a class-level
// field initializer, on the `uses` label, in all four C# corpora.
//
// WHY A FIXTURE AND NOT JUST A GATE. The blocker was found by instrumenting the oracle's push
// condition, not by any analyzer fixture, because the defect is entirely on the truth side — F3
// asserts what the ANALYZER emits, so a perfect analyzer passes every fixture while the oracle
// judging it lies. That blindness is structural and no fixture can fix it. What a fixture CAN do is
// pin the ANALYZER's half of the contract, so that if the analyzer ever stops publishing these
// reads, this fails rather than the lane quietly losing rows.
//
// The four shapes below are the bisection from cs-deep-64, which is what localised the class:
// a method body and a constructor body both read class consts correctly today, and a local
// declaration does too. Only the field initializer was dropped, so the fixture carries the field
// case alongside three that already work — a fix that over-corrects and breaks a neighbouring case
// is caught here rather than discovered later as a corpus regression.
class FieldInitReads
{
    private const int MaxDepth = 100;
    private const string Label = "x";
    private int _seed = MaxDepth;          // FIELD initializer reading a const — CS-D11
    private string _label = Label;         // a second field initializer, different const
    private int _other = _seed;            // a field initializer reading a FIELD

    private readonly int _viaCtor;
    private readonly string _labelViaCtor;

    // Constructor assignments already worked, and are pinned so a fix that changes the scope
    // question cannot silently start dropping them.
    public FieldInitReads()
    {
        _viaCtor = MaxDepth;
        _labelViaCtor = Label;
    }

    // A method body and a LOCAL declaration both worked; pinned for the same reason.
    public int ReadInBody() { return MaxDepth; }

    public int ReadInLocal()
    {
        int local = MaxDepth;
        return local + ReadInBody() + _viaCtor;
    }
}