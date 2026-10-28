#!/bin/bash
# usage: e2e.sh <tender_id> <role> <file> [party]  -> uploads then loops process steps until done
B=${BASE:-http://localhost:3000}
T=$1; ROLE=$2; FILE=$3; PARTY=$4
ARGS=(-F "file=@$FILE" -F "role=$ROLE")
[ -n "$PARTY" ] && ARGS+=(-F "party_name=$PARTY")
RESP=$(curl -s -X POST "$B/api/tenders/$T/documents" "${ARGS[@]}")
DOC=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['document']['id'] if 'document' in d else 'ERR '+json.dumps(d))")
case "$DOC" in ERR*) echo "$DOC"; exit 1;; esac
echo "doc=$DOC"
for i in $(seq 1 40); do
  R=$(curl -s -X POST "$B/api/documents/$DOC/process" -H 'content-type: application/json' -d '{}')
  echo "step $i: $R"
  echo "$R" | grep -q '"done":true' && break
done
