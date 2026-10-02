Class C
    Private m_KeyedNodesHash As Generic.Dictionary(Of String, Node)
    Private m_ItemsList As System.Collections.Generic.Dictionary(Of String, System.Collections.Generic.List(Of Integer))
    Public Overrides Function F(ByVal t As Func(Of CallSite, Object, Object)) As String
        Return CStr(CallSite(Of Func(Of CallSite, Object, Object)).Create(t))
    End Function
End Class
