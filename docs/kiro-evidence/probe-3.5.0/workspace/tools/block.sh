#!/bin/bash
in=$(cat)
if printf '%s' "$in" | grep -q 'blocked.json'; then
  printf '%s\tpre-write-block\tBLOCKED %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$in" | tr '\n' ' ' | cut -c1-300)" >> "$(dirname "$0")/../hooks.log"
  echo "probe: writes to blocked.json are refused by hook" >&2; exit 2
fi
exit 0
