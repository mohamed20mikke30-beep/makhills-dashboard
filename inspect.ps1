$s=[System.IO.File]::ReadAllText('c:\Users\HP\Downloads\mjk-sales-main\mjk-sales-main\firebase-firestore-compat.js')
# find functions factory maybe in app
# Search for 'functions(' string occurrences count
$q='functions('
$i=$s.IndexOf($q)
$cnt=0
while($i -ge 0 -and $cnt -lt 8){
  Write-Output ('idx '+$i)
  Write-Output $s.Substring([Math]::Max(0,$i-100),220)
  Write-Output '---'
  $i=$s.IndexOf($q,$i+1)
  $cnt++
}



