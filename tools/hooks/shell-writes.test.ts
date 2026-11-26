import { describe, expect, it } from 'vitest'
import { analyzeShell, runsCatalogCommand } from './shell-writes.ts'

const ROOT = '/work/steam'
const CAT = 'content/' + 'catalog' + '.json'
const paths = (cmd: string, cwd?: string) => analyzeShell(cmd, { root: ROOT, cwd }).targets.map((t) => `${t.kind}:${t.path}`)

describe('analyzeShell: a shell write under src/ (hook-coverage H1)', () => {
  it.each([
    ['a heredoc through cat >', "cat > src/x.ts <<'E'\nexport const a = 1\nE", ['src:src/x.ts']],
    ['a heredoc through cat >>', "cat >> src/app/app.css <<'E'\n.a { color: red }\nE", ['src:src/app/app.css']],
    ['a heredoc after cd and &&', `cd ${ROOT} && cat > src/x.ts <<EOF\nexport const a = 1\nEOF`, ['src:src/x.ts']],
    ['an echo redirect', "echo 'export const a = 1' > src/a.ts", ['src:src/a.ts']],
    ['a printf append', "printf '%s\\n' hi >> src/a.ts", ['src:src/a.ts']],
    ['a redirect with the fd number', 'echo x 1> src/a.ts', ['src:src/a.ts']],
    ['a tee pipe', "echo 'x' | tee src/a.ts", ['src:src/a.ts']],
    ['tee -a with two files', 'echo x | tee -a src/a.ts src/b.ts', ['src:src/a.ts', 'src:src/b.ts']],
    ['sed -i', 'sed -i "s/a/b/" src/a.ts', ['src:src/a.ts']],
    ['sed -i with an empty suffix (macOS)', "sed -i '' 's/a/b/' src/a.ts", ['src:src/a.ts']],
    ['sed -i.bak', "sed -i.bak 's/a/b/' src/a.ts", ['src:src/a.ts']],
    ['sed -i with -e', "sed -i -e 's/a/b/' -e 's/c/d/' src/a.ts src/b.ts", ['src:src/a.ts', 'src:src/b.ts']],
    ['perl -pi', "perl -pi -e 's/a/b/' src/a.ts", ['src:src/a.ts']],
    ['cp to src/', 'cp /tmp/x.ts src/a.ts', ['src:src/a.ts']],
    ['mv to a src/ directory', 'mv /tmp/x.ts src/steam/', ['src:src/steam/']],
    ['touch', 'touch src/a.ts', ['src:src/a.ts']],
    ['dd of=', 'dd if=/tmp/x of=src/a.ts', ['src:src/a.ts']],
    ['git show redirected into src/', 'git show f30aa94:src/steam/shaders.ts > src/steam/shaders.ts', ['src:src/steam/shaders.ts']],
    ['git checkout of a path', 'git checkout -- src/a.ts', ['src:src/a.ts']],
    ['git restore of a path', 'git restore src/a.ts', ['src:src/a.ts']],
    ['an absolute path inside the root', `echo x > ${ROOT}/src/a.ts`, ['src:src/a.ts']],
    ['./ and doubled slashes', 'echo x > ./src//a.ts', ['src:src/a.ts']],
    ['a path that goes up and comes back', 'echo x > src/steam/../a.ts', ['src:src/a.ts']],
    ['a quoted path', 'echo x > "src/a b.ts"', ['src:src/a b.ts']],
    ['a leading $VAR/ is taken as the root', 'echo x > "$PWD/src/a.ts"', ['src:src/a.ts']],
    ['cd into src', 'cd src && echo x > a.ts', ['src:src/a.ts']],
    ['cd with an absolute path, then a relative redirect', `cd ${ROOT}/src/steam; echo x > a.ts`, ['src:src/steam/a.ts']],
    ['the cwd of the tool call', 'echo x > a.ts', ['src:src/a.ts'], `${ROOT}/src`],
    ['bash -c', "bash -c 'echo x > src/a.ts'", ['src:src/a.ts']],
    ['a command substitution', 'echo "$(echo x > src/a.ts)"', ['src:src/a.ts']],
    ['an interpreter heredoc that writes', "python3 - <<'E'\np = 'src/steam/a.ts'\ns = open(p).read()\nopen(p, 'w').write(s)\nE", ['src:src/steam/a.ts']],
    ['an interpreter heredoc with pathlib', "python3 <<'E'\nfrom pathlib import Path\nPath('src/a.ts').write_text('x')\nE", ['src:src/a.ts']],
    ['node -e', `node -e "require('fs').writeFileSync('src/a.ts','x')"`, ['src:src/a.ts']],
    ['a node heredoc', "node - <<'E'\nconst fs = require('fs')\nfs.appendFileSync('src/a.ts', 'x')\nE", ['src:src/a.ts']],
    ['python3 -c with open(..., "a")', `python3 -c "open('src/a.ts', 'a').write('x')"`, ['src:src/a.ts']],
    ['a script whose path is built from parts: the target is src/ without a name', `python3 -c "import os; open(os.path.join('src','steam','a.ts'),'w').write('x')"`, ['src:src/(script)']],
    ['a patch in a heredoc names its files', "git apply <<'E'\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\nE", ['src:src/a.ts']],
  ] as [string, string, string[], string?][])('%s', (_n, cmd, want, cwd) => {
    expect(paths(cmd, cwd)).toEqual(want)
  })

  it('marks a test file as a test, and src/__tests__ too', () => {
    const t = analyzeShell('cat > src/a.test.ts <<E\nx\nE\necho x > src/b.test.tsx\necho x > src/__tests__/c.ts\necho x > src/d.ts', { root: ROOT }).targets
    expect(t.map((x) => [x.path, x.test])).toEqual([['src/a.test.ts', true], ['src/b.test.tsx', true], ['src/__tests__/c.ts', true], ['src/d.ts', false]])
  })

  it.each([
    ['a read', 'cat src/a.ts'],
    ['a grep over src/', 'grep -rn speechSynthesis src/ | head'],
    ['a test run', 'npm test 2>&1 | tail -5'],
    ['a write to docs/', 'echo x > docs/a.md'],
    ['a write to /tmp', 'echo x > /tmp/a.ts'],
    ['a write to e2e/ that imports from src/', "cat > e2e/x.spec.ts <<'E'\nimport { a } from '../src/steam/a'\nE"],
    ['a write to tools/', "cat > tools/x.ts <<'E'\nexport const a = 1\nE"],
    ['a copy out of src/', 'cp src/a.ts /tmp/b.ts'],
    ['a delete', 'rm src/a.ts'],
    ['a redirect to /dev/null and stderr merge', 'cat src/a.ts > /dev/null 2>&1'],
    ['an ls into /tmp', 'ls src/ > /tmp/o.txt'],
    ['src/ named in a string that is not a path', 'echo "see src/a.ts" > notes.txt'],
    ['git add and commit with a message heredoc that has an apostrophe', "git add src/a.ts && git commit -m \"$(cat <<'EOF'\nfix: don't (really) break\nEOF\n)\""],
    ['git diff', 'git diff -U0 -- src/'],
    ['sed without -i', "sed -n '1,5p' src/a.ts > /tmp/o"],
    ['an interpreter that only reads src/', "python3 - <<'E'\nimport json\nprint(open('src/a.ts').read())\nE"],
    ['an interpreter that writes outside src/', "python3 - <<'E'\nopen('docs/a.md','w').write('x')\nE"],
    ['node printing a file of src/ to stdout', `node -e "process.stdout.write(require('fs').readFileSync('src/a.ts','utf8'))"`],
    ['a script file', 'node scripts/render-static-panes.ts'],
    ['the catalog command', 'npm run catalog'],
    ['the catalog command through tsx', 'npx tsx tools/steam-ingest/cli.ts catalog'],
    ['a cp whose destination is a directory called srcs', 'cp x srcs/a.ts'],
  ])('%s: no target', (_n, cmd) => {
    expect(paths(cmd)).toEqual([])
  })

  it('a command that writes the catalog is a catalog target, by any of the means', () => {
    for (const cmd of [`echo '{}' > ${CAT}`, `cp /tmp/x ${CAT}`, `sed -i 's/a/b/' ${CAT}`, `python3 -c "open('${CAT}','w').write('[]')"`, `node -e "require('fs').writeFileSync('${CAT}','[]')"`, `cat > ${CAT} <<'E'\n[]\nE`, `echo '[]' | tee ${ROOT}/${CAT}`]) {
      expect(paths(cmd), cmd).toEqual([`catalog:${CAT}`])
    }
    expect(paths(`cat ${CAT}`)).toEqual([])
    expect(paths(`echo x > content/recipes/quinces-marmalade/review.md`)).toEqual([])
  })

  it('reports an open quote and a heredoc with no end as not parsed', () => {
    expect(analyzeShell("echo 'unclosed > src/a.ts", { root: ROOT }).parsed).toBe(false)
    expect(analyzeShell("cat > src/a.ts <<'E'\nno end", { root: ROOT }).parsed).toBe(false)
    expect(analyzeShell('echo "unclosed', { root: ROOT }).parsed).toBe(false)
    expect(analyzeShell("cat > src/a.ts <<'E'\nx\nE", { root: ROOT }).parsed).toBe(true)
  })
})

describe('analyzeShell: a2a round 07 — subshells, launchers, eval, variables, what it cannot resolve', () => {
  const a = (cmd: string, expandVars = false) => analyzeShell(cmd, { root: ROOT, expandVars })
  it('a cd inside ( … ) does not leak out, either way', () => {
    expect(paths('(cd /tmp && ls); printf x > src/steam/x.ts')).toEqual(['src:src/steam/x.ts'])
    expect(paths('(cd src && ls); echo hi > notes.txt')).toEqual([])
    expect(paths('(cd src && echo hi > notes.ts)')).toEqual(['src:src/notes.ts'])
  })
  it('a cd inside bash -c stays in that shell', () => {
    expect(paths('bash -c "cd src"; echo hi > notes.txt')).toEqual([])
    expect(paths('bash -c "cd src && echo hi > a.ts"')).toEqual(['src:src/a.ts'])
  })
  it('reads through npx and bunx (with their options) to the interpreter they launch', () => {
    expect(paths(`npx tsx -e "require('fs').writeFileSync('src/steam/x.ts', 'x')"`)).toEqual(['src:src/steam/x.ts'])
    expect(paths(`npx -y -p tsx tsx -e "require('fs').writeFileSync('src/a.ts', 'x')"`)).toEqual(['src:src/a.ts'])
    expect(paths('bunx prettier --write src/a.ts')).toEqual([])
  })
  it('reads the command eval runs', () => {
    expect(paths('eval "echo x > src/x.ts"')).toEqual(['src:src/x.ts'])
  })
  it('substitutes a variable set earlier in the command only with expandVars (the gate), never for the ledger', () => {
    const cmd = 'f=src/steam/x.ts; printf x > "$f"'
    expect(a(cmd).targets).toEqual([])
    expect(a(cmd).unresolved).toEqual(['$f'])
    expect(a(cmd, true).targets.map((t) => t.path)).toEqual(['src/steam/x.ts'])
    expect(a('export F=src; echo x > $F/a.ts', true).targets.map((t) => t.path)).toEqual(['src/a.ts'])
    expect(a('bash -c "f=src/a.ts"; echo x > "$f"', true).targets).toEqual([])
  })
  it('lists the writes it saw and could not resolve', () => {
    expect(a('echo hi > $OUT').unresolved).toEqual(['$OUT'])
    expect(a('git apply fix.diff').unresolved).toEqual(['git apply: a diff from a file or stdin'])
    expect(a('patch -p1 < fix.diff').unresolved).toEqual(['patch: a diff from a file or stdin'])
    expect(a("git apply <<'E'\n+++ b/src/a.ts\nE").unresolved).toEqual([])
    expect(a('echo hi > /tmp/x').unresolved).toEqual([])
  })
})

describe('runsCatalogCommand: the catalog CLI run by an interpreter, not a word that names it (a2a round 07)', () => {
  it.each([
    ['npm run catalog', true],
    ['tsx tools/steam-ingest/cli.ts catalog', true],
    ['npx tsx tools/steam-ingest/cli.ts catalog', true],
    ['echo tools/steam-ingest/cli.ts catalog', false],
    ['cat tools/steam-ingest/cli.ts catalog', false],
    ['echo npm run catalog', false],
  ])('%s → %s', (cmd, want) => expect(runsCatalogCommand(cmd)).toBe(want))
})
