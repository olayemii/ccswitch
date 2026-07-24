#!/usr/bin/env bash
# Print the CHANGELOG.md section for one version, without its heading.
#
#   scripts/changelog-extract.sh 0.2.1
#
# Reads CHANGELOG.md from the repo root. Exits non-zero if the version has no
# section, so a release can't be published with empty notes.
set -euo pipefail

version="${1:?usage: changelog-extract.sh <version>}"
changelog="$(dirname "$0")/../CHANGELOG.md"

body="$(
  awk -v v="$version" '
    $0 ~ "^## \\[" v "\\]" { flag=1; next }
    flag && /^## \[/ { exit }
    # The oldest section runs to EOF, so also stop at the trailing block of link
    # reference definitions — they are appended separately below.
    flag && /^\[[^]]+\]: / { exit }
    flag { print }
  ' "$changelog"
)"

# Trim leading and trailing blank lines.
body="$(printf '%s\n' "$body" | sed -e '/./,$!d')"
body="$(printf '%s' "$body" | awk '
  { lines[n++] = $0 }
  END { while (n > 0 && lines[n-1] == "") n--; for (i = 0; i < n; i++) print lines[i] }
')"

if [ -z "$body" ]; then
  echo "No CHANGELOG.md section found for version '$version'." >&2
  exit 1
fi

printf '%s\n' "$body"

# Link reference definitions ([#1]: https://…) live at the bottom of the file,
# outside every version section. Without them a reference like [#1] renders as
# literal text in the release notes, so carry the ones this section actually
# uses.
# Two files: collect the section body first, then emit the definitions it uses.
# (Passing the body via -v breaks on BSD awk, which rejects embedded newlines.)
refs="$(
  printf '%s\n' "$body" | awk '
    NR == FNR { body = body $0 "\n"; next }
    /^\[[^]]+\]: / {
      label = substr($0, 1, index($0, "]:"))
      if (index(body, label) > 0) print
    }
  ' - "$changelog"
)"

if [ -n "$refs" ]; then
  printf '\n%s\n' "$refs"
fi
