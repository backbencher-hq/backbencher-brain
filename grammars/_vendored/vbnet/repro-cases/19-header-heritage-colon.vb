Public NotInheritable Class Collection : Implements ICollection, IList
    Public Sub Add(ByVal item As Object)
    End Sub
End Class

Public Class Derived : Inherits Base, Implements IOne, ITwo
End Class

Public Interface IHandler : IDisposable
End Interface

Public Structure Point : IComparable
End Structure
