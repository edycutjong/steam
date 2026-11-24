#!/bin/bash
# usage: log.sh <hook-name> ; appends one line with the stdin JSON
in=$(cat)
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$(printf '%s' "$in" | tr '\n' ' ' | cut -c1-600)" >> "$(dirname "$0")/../hooks.log"
exit 0
