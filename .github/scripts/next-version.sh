#!/usr/bin/env bash
# Next semantic version from Angular-convention commit subjects since the last vX.Y.Z tag reachable from a commit.
# Used by .github/workflows/release.yml, and runnable by hand as a dry run (it only reads git):
#
#   bash .github/scripts/next-version.sh [commit]        # default HEAD; NOTES_FILE=path also writes the release notes
#
# Rules, applied to each non-merge commit after the last tag:
#   1. Authorship prefixes are stripped first (repeatedly): "[kiro] ", "[claude-direct] ", "kiro: ", "claude-direct: ".
#   2. What is left must start with an Angular type:  type(scope)!: subject   (scope and ! are optional).
#        feat               -> minor
#        fix, perf          -> patch
#        build chore ci docs refactor revert style test -> nothing
#      A "!" before the colon, or a "BREAKING CHANGE:" / "BREAKING-CHANGE:" footer on a typed commit -> major.
#   3. While the version is 0.x a breaking change bumps MINOR, not major: 0.y.z is initial development (semver item 4),
#      so 1.0.0 stays a deliberate human decision and is never cut by a commit message.
#   4. A subject with no recognised type, including a prefix-only one ("[kiro] tidy the shelf"), cuts nothing.
#   The highest bump among the commits wins.
#
# Output on stdout, in GITHUB_OUTPUT format: last, next, bump (major|minor|patch|none), released_in.
set -euo pipefail

REF="${1:-HEAD}"
SEMVER='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
TYPED='^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^()]+\))?(!)?: .+'
REPO="${GITHUB_REPOSITORY:-$(git config --get remote.origin.url | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')}"

SHA=$(git rev-parse --verify --quiet "${REF}^{commit}") || { echo "::error::not a commit: $REF" >&2; exit 1; }

# Already shipped? A run for a newer commit can finish first and tag a version that contains this commit.
RELEASED_IN=$(git tag --contains "$SHA" --list 'v*' | grep -E "$SEMVER" | sort -V | head -n 1 || true)
LAST=$(git tag --merged "$SHA" --list 'v*' | grep -E "$SEMVER" | sort -V | tail -n 1 || true)
if [ -n "$RELEASED_IN" ]; then
  printf 'last=%s\nnext=\nbump=none\nreleased_in=%s\n' "$LAST" "$RELEASED_IN"
  exit 0
fi

strip_authorship() {
  local s="$1"
  while :; do
    case "$s" in
      "[kiro] "*)          s="${s#"[kiro] "}" ;;
      "[claude-direct] "*) s="${s#"[claude-direct] "}" ;;
      "kiro: "*)           s="${s#"kiro: "}" ;;
      "claude-direct: "*)  s="${s#"claude-direct: "}" ;;
      *) break ;;
    esac
  done
  printf '%s' "$s"
}

# Release notes quote subjects verbatim; an @handle inside one would notify a stranger, so it goes in a code span.
# shellcheck disable=SC2016 # the backticks are literal Markdown, not a command substitution
note_line() { printf -- '- %s (%s)\n' "$(sed -E 's/@([A-Za-z0-9_][A-Za-z0-9_./-]*)/`@\1`/g' <<< "$1")" "${2:0:7}"; }

RANK=0 BREAKING="" FEATURES="" FIXES=""
RANGE="$SHA"; [ -n "$LAST" ] && RANGE="${LAST}..${SHA}"
while IFS= read -r -d $'\x1e' REC; do
  REC="${REC#$'\n'}"
  [ -z "$REC" ] && continue
  C_SHA="${REC%%$'\x1f'*}"; REST="${REC#*$'\x1f'}"
  SUBJECT="${REST%%$'\x1f'*}"; BODY="${REST#*$'\x1f'}"
  S=$(strip_authorship "$SUBJECT")
  [[ "$S" =~ $TYPED ]] || continue
  TYPE="${BASH_REMATCH[1]}"; BANG="${BASH_REMATCH[3]}"
  if [ -n "$BANG" ] || grep -qE '^BREAKING[ -]CHANGE: ' <<< "$BODY"; then
    RANK=3; BREAKING+="$(note_line "$SUBJECT" "$C_SHA")"$'\n'
  fi
  case "$TYPE" in
    feat)     [ "$RANK" -lt 2 ] && RANK=2; FEATURES+="$(note_line "$SUBJECT" "$C_SHA")"$'\n' ;;
    fix|perf) [ "$RANK" -lt 1 ] && RANK=1; FIXES+="$(note_line "$SUBJECT" "$C_SHA")"$'\n' ;;
  esac
done < <(git log --no-merges --format='%H%x1f%s%x1f%b%x1e' "$RANGE")

if [ "$RANK" -eq 0 ]; then
  printf 'last=%s\nnext=\nbump=none\nreleased_in=\n' "$LAST"
  exit 0
fi

CUR="${LAST:-v0.0.0}"; CUR="${CUR#v}"
IFS=. read -r MA MI PA <<< "$CUR"
case "$RANK" in
  3) if [ "$MA" -eq 0 ]; then BUMP="minor"; MI=$((MI + 1)); PA=0; else BUMP="major"; MA=$((MA + 1)); MI=0; PA=0; fi ;;
  2) BUMP="minor"; MI=$((MI + 1)); PA=0 ;;
  1) BUMP="patch"; PA=$((PA + 1)) ;;
esac
NEXT="v${MA}.${MI}.${PA}"
[[ "$NEXT" =~ $SEMVER ]] || { echo "::error::refusing malformed tag '$NEXT'" >&2; exit 1; }

if [ -n "${NOTES_FILE:-}" ]; then
  {
    [ -n "$BREAKING" ] && printf '## Breaking changes\n\n%s\n' "$BREAKING"
    [ -n "$FEATURES" ] && printf '## Features\n\n%s\n' "$FEATURES"
    [ -n "$FIXES" ]    && printf '## Fixes\n\n%s\n' "$FIXES"
    if [ -n "$LAST" ]; then
      printf '**Full changelog:** https://github.com/%s/compare/%s...%s\n' "$REPO" "$LAST" "$NEXT"
    else
      printf '**Full history:** https://github.com/%s/commits/%s\n' "$REPO" "$NEXT"
    fi
  } > "$NOTES_FILE"
fi
printf 'last=%s\nnext=%s\nbump=%s\nreleased_in=\n' "$LAST" "$NEXT" "$BUMP"
