param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)
$joined = if ($Args) { $Args -join ' ' } else { '(none)' }
Write-Output "Skill code-review executed. Args: $joined"