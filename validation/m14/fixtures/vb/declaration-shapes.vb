Imports System.Collections.Generic

Namespace Contoso.Shapes

    ''' A base type, so `extends` has a non-local target to point at.
    Public Class Shape
        Public Sub New()
        End Sub
    End Class

    Public Class Box
        Inherits Shape

        ''' A nested enum: `contains Box -> Kind` is the edge a reader walks,
        ''' and it is the edge the pre-fix analyzer published an ownerName for
        ''' and then never emitted.
        Public Enum Kind
            Small
            Large
        End Enum

        Public Sub New(width As Integer, height As Integer)
            Me.Width = width
            Me.Height = height
        End Sub

        ''' THREE declarators in one statement: `Dim Left, Top, Depth As Integer`
        ''' is one field_declaration with three variable_declarator children, so
        ''' it is three members. Reading one name per field_declaration is what
        ''' made two of them look like fabrications.
        Public Left, Top, Depth As Integer

        Public Const MaxDepth As Integer = 32

        Public Function Area() As Integer
            Return Me.Width * Me.Height
        End Function

        Public Sub Resize(ByVal w As Integer)
            Dim scratch, spare As Integer
            scratch = w
            Me.Width = scratch + spare
        End Sub
    End Class

    Public Class Registry
        Private ReadOnly _items As New Dictionary(Of String, Shape)

        Public Sub Add(ByVal key As String, ByVal item As Shape)
            _items.Add(key, item)
        End Sub

        Public Function Build() As Box
            ''' A construction: the callee is `Box`, not the text `New Box`.
            Return New Box(1, 2)
        End Function
    End Class

    ''' `Implements IShape.Draw` is a MEMBER-LEVEL heritage clause: a relationship
    ''' of its own, distinct from the class's own `Implements IShape`, and it used
    ''' to be dropped because nothing read a member's clause. Note the TARGET keeps
    ''' its qualifier: `Draw` alone is the method's own name, so last-segment
    ''' reduction would make the edge `implements Draw -> Draw` -- a symbol pointing
    ''' at itself, which answers none of the questions asked of it.
    Public Interface IShape
        Sub Draw()
    End Interface

    Public Class Canvas
        Implements IShape

        Public Sub Draw() Implements IShape.Draw
        End Sub
    End Class

    ''' An interface's members are DECLARATIONS. They were in neither the
    ''' declaration set nor the silent set, which is the whole defect: nothing visited
    ''' them, so the interface below was published as an empty shell while the class
    ''' implementing it had all three.
    Public Interface IMeasurable
        Function Area() As Double
        Property Label As String
    End Interface

    Public Class Square
        Implements IMeasurable

        Private _side As Double

        ''' An OPERATOR. `operator_declaration` has no name field either, so the same
        ''' empty-name guard that hid constructors hid every operator -- and its visitor
        ''' skipped the operator's own symbol as punctuation, so it produced nothing even when
        ''' reached. The name is the contract literal; the symbol is in metadata.
        Public Shared Operator =(ByVal a As Square, ByVal b As Square) As Boolean
            Return a._side = b._side
        End Operator

        Public Function Area() As Double
            Return _side * _side
        End Function

        Public Property Label As String
            Get
                Return "square"
            End Get
        End Property
    End Class
    ''' EVERY modifier, not the first one. This grammar emits `modifiers` as a
    ''' REPEATED field -- one per modifier -- and a singular field read returned only
    ''' `public`, so `Shared` below reported isStatic=false and `Overrides` published no
    ''' edge at all. VB writes `Public` first by convention, so the one modifier that was
    ''' ever read was the one least worth reading.
    Public Overridable Property Size As Integer
        Get
            Return 0
        End Get
    End Property

    Public Overridable Sub Reset()
    End Sub

    Public Class Square2
        Inherits Square

        ''' `overrides` is qualified by the base type. The unqualified form is the
        ''' self-edge `Reset -> Reset`, which cannot answer "what does this override?", and
        ''' the base type is right here because `Inherits` was already read to publish
        ''' `extends`. A PROPERTY overriding -- not just a method -- which is how P3D's Item
        ''' hierarchy is written, and which published nothing until this was wired.
        Public Overrides Property Size As Integer
            Get
                Return 1
            End Get
        End Property

        Public Overrides Sub Reset()
        End Sub
    End Class

    ''' `As New Timers.Timer()` puts an `array_type` in `declared_type` -- the `()`
    ''' reads as bounds -- so the field's TYPE is an `array_type` wrapping the real
    ''' name. Read as the node's own text it published
    ''' `references _watcher -> "Timers.Timer()"`, the whole expression parens
    ''' included, which is not a name in the file and not navigable. Declared last
    ''' so that no line number above this one moves.
    Public Class WatcherHost
        Private _watcher As New Timers.Timer()
    End Class
End Namespace
