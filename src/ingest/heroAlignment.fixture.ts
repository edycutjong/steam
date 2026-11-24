// The committed alignment.json of quinces-marmalade without its component-partition entries for the hero lines (9 and 10).
// The earlier bugfix specs froze the hero as whole lines; those preservation tests now run on this text, which is what the
// recipe's alignment.json was before turn 24: it proves that nothing changed for a note that has no component boundary.

export function withoutHeroPartition(alignmentJson: string): string {
  const a = JSON.parse(alignmentJson) as { lines: { line: number }[] }
  return JSON.stringify({ ...a, lines: a.lines.filter((l) => l.line < 9) })
}
