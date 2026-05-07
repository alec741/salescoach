param()

foreach ($taskName in @("DecodedCoach-Hourly", "DecodedCoach-DailySummary")) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task: $taskName"
  } else {
    Write-Host "Task not found: $taskName"
  }
}
