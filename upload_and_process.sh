#!/bin/bash
# Usage: upload_and_process.sh <tender_id> <role> <file_path> [party_name]
TENDER_ID=$1
ROLE=$2
FILE=$3
PARTY=$4

if [ -n "$PARTY" ]; then
  RESP=$(curl -s -X POST "http://localhost:3000/api/tenders/$TENDER_ID/documents" \
    -F "file=@$FILE" -F "role=$ROLE" -F "party_name=$PARTY")
else
  RESP=$(curl -s -X POST "http://localhost:3000/api/tenders/$TENDER_ID/documents" \
    -F "file=@$FILE" -F "role=$ROLE")
fi

DOC_ID=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.id)}catch(e){console.log('ERROR: '+d)}})")

if [[ "$DOC_ID" == ERROR* ]]; then
  echo "UPLOAD FAILED for $FILE: $DOC_ID"
  exit 1
fi

echo "Uploaded $FILE -> $DOC_ID, processing..."
curl -s -X POST "http://localhost:3000/api/documents/$DOC_ID/process" > /dev/null

curl -s "http://localhost:3000/api/documents/$DOC_ID" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
const j=JSON.parse(d);
console.log('  status:', j.document.status, '| party:', j.document.party_name, '| stated_total:', j.document.stated_total, '| items:', j.items.length, '| matched:', j.items.filter(i=>i.tender_line_id).length);
if (j.document.issues.length) console.log('  issues:', JSON.stringify(j.document.issues.map(i=>i.code)));
})"
echo "$DOC_ID"
