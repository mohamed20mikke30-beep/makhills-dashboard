$src = Get-Content 'c:\Users\HP\Downloads\mjk-sales-main\mjk-sales-main\index.html'
$lines = $src[977..5169]
$text = $lines -join "`n"
$inSingle = $false
$inDouble = $false
$inTemplate = $false
$inLineComment = $false
$inBlockComment = $false
$escape = $false

$brace = 0; $paren = 0; $bracket = 0
$issues = @()
$lineNo = 978

$chars = $text.ToCharArray()
for ($i = 0; $i -lt $chars.Length; $i++) {
    $c = $chars[$i]
    if ($c -eq "`n") { $lineNo++; 
        if ($inLineComment) { $inLineComment = $false }
        continue
    }
    if ($inLineComment) { continue }
    if ($inBlockComment) {
        if ($c -eq '*' -and $i+1 -lt $chars.Length -and $chars[$i+1] -eq '/') { $inBlockComment = $false; $i++ }
        continue
    }
    if ($inSingle) {
        if ($escape) { $escape = $false; continue }
        if ($c -eq '\') { $escape = $true; continue }
        if ($c -eq "'") { $inSingle = $false }
        continue
    }
    if ($inDouble) {
        if ($escape) { $escape = $false; continue }
        if ($c -eq '\') { $escape = $true; continue }
        if ($c -eq '"') { $inDouble = $false }
        continue
    }
    if ($inTemplate) {
        if ($escape) { $escape = $false; continue }
        if ($c -eq '\') { $escape = $true; continue }
        if ($c -eq '`') { $inTemplate = $false }
        continue
    }
    if ($c -eq '/' -and $i+1 -lt $chars.Length) {
        if ($chars[$i+1] -eq '/') { $inLineComment = $true; $i++; continue }
        if ($chars[$i+1] -eq '*') { $inBlockComment = $true; $i++; continue }
    }
    if ($c -eq "'") { $inSingle = $true; continue }
    if ($c -eq '"') { $inDouble = $true; continue }
    if ($c -eq '`') { $inTemplate = $true; continue }
    switch ($c) {
        '{' { $brace++ }
        '}' { $brace--; if ($brace -lt 0) { $issues += "NEG brace line $lineNo val=$brace"; $brace = 0 } }
        '(' { $paren++ }
        ')' { $paren--; if ($paren -lt 0) { $issues += "NEG paren line $lineNo val=$paren"; $paren = 0 } }
        '[' { $bracket++ }
        ']' { $bracket--; if ($bracket -lt 0) { $issues += "NEG bracket line $lineNo val=$bracket"; $bracket = 0 } }
    }
}
$result = "FINAL brace=$brace paren=$paren bracket=$bracket`nNEGATIVE EVENTS: $($issues.Count)`n" + ($issues -join "`n")
$result | Out-File 'c:\Users\HP\Downloads\mjk-sales-main\scan_result.txt' -Encoding UTF8