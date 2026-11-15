Imports System.Collections.Generic

Namespace Contoso.Kinds

    ''' The type whose members are READ below. `uses` names the MEMBER, and whether
    ''' that name resolves to something this file declares is the confidence
    ''' question the honesty contract §4 requires an edge under 0.7 to answer.
    Public Class Gauge
        Public Property Reading As Integer

        Public Function Scale(ByVal raw As Integer) As Integer
            Return raw * 2
        End Function

        ''' A member returning the SAME type, so the chained call below is the
        ''' shape a real receiver chain has rather than a shape invented to be
        ''' awkward.
        Public Function Inner() As Gauge
            Return Me
        End Function

        Public Sub Reset()
        End Sub
    End Class

    ''' A `Module` is VB's own construct for hosting members at namespace level
    ''' without a wrapping type: the constructions below are REAL member code, and
    ''' the source's five construction surfaces all live here. (`Module` members
    ''' are Shared implicitly, which is what makes this the language's spelling.)
    Public Module Construction
    ''' `instantiates` #1. `New Gauge()` is an `object_creation_expression`, and the
    ''' name is in a `type` field with no `function` field at all, so reading the
    ''' callee the way an invocation is read published the literal text
    ''' `New Gauge` and then published no `instantiates` edge whatsoever.
    Public Function MakeGauge() As Gauge
        Return New Gauge()
    End Function

    ''' `instantiates` #2. `New Gauge(1)` is an ARRAY CREATION in this grammar --
    ''' the same node type a VB construction with arguments produces -- so a visitor
    ''' keyed on `object_creation_expression` alone misses it and one keyed on
    ''' `array_creation_expression` cannot tell an array from a constructor with
    ''' arguments. `metadata.constructsArray` records which node produced the edge
    ''' instead of pretending the two are one thing.
    Public Function MakeScaledGauge() As Gauge
        Return New Gauge(1)
    End Function

    ''' `instantiates` #3. `As New T` is a construction with NO EXPRESSION around
    ''' it: it hangs off the declaration's own `as_clause`, so it is reachable only
    ''' from the declaration visitor and from nowhere an expression walk looks.
    Public Class Holder
        Private _gauge As New Gauge
    End Class

    ''' `instantiates` #4. An ARRAY construction over a PREDEFINED type. `Integer`
    ''' is never a project symbol, so this edge is the heuristic-confidence one, and
    ''' the two are different facts: one is "this file constructs a type it declares"
    ''' and the other is "this file allocates an array of a type it does not".
    Public Function MakeSlots() As Integer()
        Return New Integer(10)
    End Function
    End Module

    Public Class Reader
        Private _gauge As New Gauge

        ''' `uses` #1 -- the shape that IS a use. `Me.Reading` is a value read that
        ''' is neither a call nor a write, which is the family's definition of
        ''' `uses` (go's GO1, csharp's CS-D4 and CS-R1). `Reading` is declared in
        ''' this file, so the edge carries the resolved confidence.
        Public Function ReadOnce() As Integer
            Return _gauge.Reading
        End Function

        ''' `uses` #2 -- the shape that is NOT a use. `obj.Method()` is a CALL, and
        ''' publishing the receiver's member as a read too would put one line under
        ''' two types, which is how a `calls` count and a `uses` count drift apart.
        Public Function ReadTwice() As Integer
            Return _gauge.Scale(3)
        End Function

        ''' `uses` #3 -- the shape that is NOT a use. `obj.Member = x` is a WRITE.
        ''' The definition is a read that is neither a call nor a write; an
        ''' assignment's left side is the other side of that sentence.
        Public Sub WriteOnce(ByVal value As Integer)
            _gauge.Reading = value
        End Sub

        ''' `uses` #4 -- the chained call. `a.Inner().Reading` puts the leading
        ''' segment under an `array_access_expression`, not directly under the
        ''' invocation, so the climb has to pass THROUGH that node or `Inner` is
        ''' published as a read of a member that is being CALLED. `Reading` at the
        ''' end of the chain is the real use.
        Public Function Chain() As Integer
            Return _gauge.Inner().Reading
        End Function

        ''' `uses` #5 -- the same read on a receiver this file does NOT declare.
        ''' The edge is still published, because the read is real, but at the
        ''' heuristic confidence: a bare member name is project-ambiguous and only
        ''' this file could have resolved it.
        Public Function ReadExternal() As Integer
            Return Metrics.Counter.Total
        End Function

        ''' `instantiates` #5 -- a construction inside an OPERATOR. The operator's
        ''' own symbol is the contract literal `operator`, so this edge is sourced
        ''' at a name a consumer can navigate to, which is also what makes it worth
        ''' asserting: a source that is a keyword would not be.
        Public Shared Operator =(ByVal a As Reader, ByVal b As Reader) As Boolean
            Dim probe As New Gauge
            Return a.ReadOnce() = b.ReadOnce()
        End Operator

        ''' An ATTRIBUTE ARGUMENT IS NOT A MEMBER READ. `<Obsolete(Marker)>` names
        ''' a symbol FOR THE COMPILER; publishing `uses -> Marker` off the
        ''' declaration it is written on would claim the declaration reads itself,
        ''' and it was doing so on three separate corpus files before it was
        ''' excluded.
        <Obsolete(Marker)>
        Public Sub Legacy()
        End Sub
    End Class

    Public Class Marker
    End Class
End Namespace