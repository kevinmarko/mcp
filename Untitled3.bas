Attribute VB_Name = "Module2"
Sub Clear_POL_Slicer()

    Dim slcrCache As SlicerCache
    Dim slcr As Slicer
    Dim targetSheetName As String
    Dim pt As PivotTable
    Dim pf As PivotField
    
    targetSheetName = "POL_Booking_Flash"
    
    ' 1. Optimization: Turn off updates at the very start of the macro
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    
    ' Set table references early to pause layout updates safely
    On Error Resume Next
    Set pt = Sheets(targetSheetName).PivotTables("PivotTable2")
    Set pf = pt.PivotFields("Status ")
    If Not pt Is Nothing Then pt.ManualUpdate = True
    On Error GoTo 0
    
    ' 2. Loop through and clear only the slicers on the target sheet
    For Each slcrCache In ActiveWorkbook.SlicerCaches
        For Each slcr In slcrCache.Slicers
            If slcr.Shape.Parent.Name = targetSheetName Then
                slcrCache.ClearManualFilter
                Exit For ' Move to next cache once a match is cleared
            End If
        Next slcr
    Next slcrCache
    
    ' 3. Safely clear the specific Pivot Field filter
    If Not pf Is Nothing Then
        On Error Resume Next
        pf.ClearAllFilters
        On Error GoTo 0
    End If
    
    ' 4. Clean up, re-enable updates, and recalculate everything
    If Not pt Is Nothing Then pt.ManualUpdate = False
    
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True


End Sub

Sub Refresh_Data()

Application.ScreenUpdating = False
Application.EnableEvents = False

    Sheets("Sector_Data").Select
    ActiveWindow.SelectedSheets.Visible = True
    Sheets("Data_download").Select
    ActiveWindow.SelectedSheets.Visible = True
 
 'ActiveWorkbook.RefreshAll
 
     Sheets("Sector_Data").Select
    ActiveWindow.SelectedSheets.Visible = False
    Sheets("Data_download").Select
    ActiveWindow.SelectedSheets.Visible = False
    
    Call Apply_Formatting

    
Application.ScreenUpdating = True
Application.EnableEvents = True
 

End Sub
Sub Clear_Booking()

    Dim sc As SlicerCache
    Dim ws As Worksheet
    
    Set ws = ThisWorkbook.Sheets("Booking_Flash")

    Application.ScreenUpdating = False
    Application.EnableEvents = False

    For Each sc In ThisWorkbook.SlicerCaches
        If sc.Slicers.Count > 0 Then
            If sc.Slicers(1).Parent.Name = ws.Name Then
                sc.ClearManualFilter
            End If
        End If
    Next sc
    
   ActiveSheet.PivotTables("PivotTable1").PivotFields( _
    "[Data_download].[Measures Overall Status].[Measures Overall Status]"). _
   ClearAllFilters
    
        On Error Resume Next
    Range("13:1000").RowHeight = 15
    
    Application.EnableEvents = True
    Application.ScreenUpdating = True

End Sub
