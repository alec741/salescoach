param()

foreach ($taskName in @(
  "DecodedCoach-Hourly",
  "DecodedCoach-GradeEvery30Minutes",
  "DecodedCoach-DailySummary",
  "DecodedCoach-Grading30Min",
  "DecodedCoach-EODDailySummary",
  "DecodedCoach-WeeklySummary",
  "DecodedCoach-MonthlySummary",
  "DecodedCoach-QuarterlySummary"
)) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task: $taskName"
  } else {
    Write-Host "Task not found: $taskName"
  }
}
