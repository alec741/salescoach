param(
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..\..").Path
)

$node = (Get-Command node).Source
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

function Register-CoachTask {
  param(
    [string]$TaskName,
    [string]$Script,
    [string]$Description,
    [Microsoft.Management.Infrastructure.CimInstance[]]$Trigger
  )

  $action = New-ScheduledTaskAction -Execute $node -Argument $Script -WorkingDirectory $ProjectPath
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger -Settings $settings -Description $Description -Force | Out-Null
  Write-Host "Registered scheduled task: $TaskName"
}

$gradingTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

Register-CoachTask `
  -TaskName "DecodedCoach-GradeEvery30Minutes" `
  -Script "scripts/coach/run-half-hour-grading.mjs" `
  -Description "Decoded Coach wakes every 30 minutes; the runner only pulls and grades during configured coaching business hours." `
  -Trigger $gradingTrigger

Register-CoachTask `
  -TaskName "DecodedCoach-DailySummary" `
  -Script "scripts/coach/run-eod-daily-summary.mjs" `
  -Description "Decoded Coach generates daily rep and manager coaching summaries with Slack delivery." `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 6:30pm)

Register-CoachTask `
  -TaskName "DecodedCoach-WeeklySummary" `
  -Script "scripts/coach/run-weekly-summary.mjs" `
  -Description "Decoded Coach generates weekly rep and manager coaching summaries on Fridays." `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 7:00pm)

Register-CoachTask `
  -TaskName "DecodedCoach-MonthlySummary" `
  -Script "scripts/coach/run-monthly-summary.mjs" `
  -Description "Decoded Coach checks each weekday evening and runs the monthly summary only on the last business day of the month." `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 7:30pm)

Register-CoachTask `
  -TaskName "DecodedCoach-QuarterlySummary" `
  -Script "scripts/coach/run-quarterly-summary.mjs" `
  -Description "Decoded Coach checks each weekday evening and runs the quarterly summary only on the last business day of the quarter." `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:00pm)

Write-Host "Project path: $ProjectPath"
