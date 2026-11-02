Attribute VB_Name = "Module10"
Sub FilterAPStatus()
Attribute FilterAPStatus.VB_Description = "Filter by AP Frozen or AP Only"
Attribute FilterAPStatus.VB_ProcData.VB_Invoke_Func = " \n14"
'
' FilterAPStatus Macro
' Filter by AP Frozen
'

'
    ActiveSheet.PivotTables("PivotTable1").PivotFields( _
        "[Data_download].[Measures Overall Status].[Measures Overall Status]"). _
        VisibleItemsList = Array( _
        "[Data_download].[Measures Overall Status].&[AP Frozen(GD6)]")
End Sub

Sub Fitler_AP_Only()
Attribute Fitler_AP_Only.VB_Description = "Filter AP Only"
Attribute Fitler_AP_Only.VB_ProcData.VB_Invoke_Func = " \n14"
'
' Fitler_AP_Only Macro
' Filter AP Only
'

'
    ActiveSheet.PivotTables("PivotTable1").PivotFields( _
        "[Data_download].[Measures Overall Status].[Measures Overall Status]"). _
        VisibleItemsList = Array( _
        "[Data_download].[Measures Overall Status].&[AP Only(GD6)]", _
        "[Data_download].[Measures Overall Status].&[AP ONLY]")
End Sub

Sub Filter_POL_AP_Frozen()
Attribute Filter_POL_AP_Frozen.VB_ProcData.VB_Invoke_Func = " \n14"
'
' Filter_POL_AP_Frozen Macro
'

    With ActiveSheet.PivotTables("PivotTable2").PivotFields("Status ")
        .PivotItems("").Visible = False
        .PivotItems("AP Frozen").Visible = True
        .PivotItems("AP Only").Visible = False
        .PivotItems("(blank)").Visible = False
    End With
End Sub

Sub Filter_POL_AP_Only()
Attribute Filter_POL_AP_Only.VB_ProcData.VB_Invoke_Func = " \n14"
    Dim pt As PivotTable
    Dim pf As PivotField
    
    ' Set references to prevent typing errors
    Set pt = ActiveSheet.PivotTables("PivotTable2")
    Set pf = pt.PivotFields("Status ") ' Note: Kept the trailing space from your original code
    
    pt.AllowMultipleFilters = True
    
    ' Speed up execution by turning off screen updates
    Application.ScreenUpdating = False
    pt.ManualUpdate = True
    
    On Error Resume Next
    ' 1. Show the target item first so a visible item always exists
    pf.PivotItems("AP Only").Visible = True
    
    ' 2. Hide the other unwanted items safely
    pf.PivotItems("").Visible = False
    pf.PivotItems("AP Frozen").Visible = False
    pf.PivotItems("(blank)").Visible = False
    On Error GoTo 0
    
    ' Refresh the layout and turn updates back on
    pt.ManualUpdate = False
    Application.ScreenUpdating = True
End Sub
