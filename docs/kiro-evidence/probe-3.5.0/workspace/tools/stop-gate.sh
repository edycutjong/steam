#!/bin/bash
in=$(cat); f="$(dirname "$0")/../.stop-count"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$f"
printf '%s\tStop-gate\tcall=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$n" "$(printf '%s' "$in" | tr '\n' ' ' | cut -c1-200)" >> "$(dirname "$0")/../hooks.log"
if [ "$n" -le 2 ]; then echo "spec-is-law probe: gate still red (call $n of 2); continue and append the line 'turn $n' to content/stop.txt" >&2; exit 1; fi
exit 0
