$deck = "CzdAsa5FhlonhsdqTVVciALPnPb"
$old = @(
  "pkB","pkc","pkj","pkz","pkF","pkK","pkW","pkC","pkD","pky",
  "pkr","pkq","pkS","pkm","pkO","pkL","pkJ","pkx","pkw","pkZ",
  "pkY","pkQ","pkk","pkM","pkT","pkV","pkp","pkt","pku","pkn",
  "pko","pkI","pkE","pke","pkR","pka","pki","pkA","pkX","pkU",
  "pkv","pkP","pkH","pkh","pkl","pkb","pkd"
)
foreach ($id in $old) {
  $out = lark-cli slides +delete-slide --presentation $deck --slide-id $id 2>&1 | Out-String
  if ($out -match '"ok": true') {
    Write-Output "DELETED $id"
  } else {
    Write-Output "FAIL $id : $($out.Substring(0,[Math]::Min(120,$out.Length)))"
  }
}
Write-Output "ALL DONE"
