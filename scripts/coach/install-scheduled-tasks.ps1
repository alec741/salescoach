param(
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..\..").Path
)

$node = (Get-Command node).Source
$hourlyName = "DecodedCoach-Hourly"
$dailyName = "DecodedCoach-DailySummary"

$hourlyAction = New-ScheduledTaskAction -Execute $node -Argument "scripts/coach/run-hourly.mjs" -WorkingDirectory $ProjectPath
$dailyAction = New-ScheduledTaskAction -Execute $node -Argument "scripts/coach/run-daily-summary.mjs" -WorkingDirectory $ProjectPath

$hourlyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 6:05am
$hourlyTrigger.Repetition = New-ScheduledTaskTrigger -Once -At 6:05am -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 12)

$dailyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 6:30pm

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $hourlyName -Action $hourlyAction -Trigger $hourlyTrigger -Settings $settings -Description "Decoded Coach hourly Close call pull and grading, 6am-6pm weekdays Eastern." -Force | Out-Null
Register-ScheduledTask -TaskName $dailyName -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Description "Decoded Coach end-of-day rep and manager coaching summaries." -Force | Out-Null

Write-Host "Registered scheduled tasks: $hourlyName, $dailyName"
Write-Host "Project path: $ProjectPath"
