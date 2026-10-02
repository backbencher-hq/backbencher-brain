Public Class Component
    Public Property PackageRequiredDependencies As New List(Of AppxDependency)
    Public Property Passes As New List(Of Pass)
    Public ReadOnly Property Created As New DateTime(2020, 1, 1)
    Public Property Simple As Integer
        Get
            Return 1
        End Get
        Set
        End Set
    End Property
End Class
