import { describe, expect, it } from 'vitest'
import { scanAdded, scanFiles } from './rule-scan.ts'

describe('rule-scan: the no-imitation rules over files already in the repository', () => {
  const files: Record<string, string> = {
    'src/a.ts': 'const x = 1\nwindow.speechSynthesis.speak(u)\n',
    'src/b.css': '.n { font-family: "Dancing Script", serif }\n',
    'src/c.ts': '// speechSynthesis is named in a comment only\nexport const y = 2\n',
    'src/a.test.ts': 'window.speechSynthesis.speak(u)\n',
    'tools/x.ts': 'window.speechSynthesis.speak(u)\n',
  }
  const read = (f: string) => files[f]

  it('reports whole-file findings under src/, skips comments, test files and files outside src/', () => {
    const rows = scanFiles(Object.keys(files), read)
    expect(rows.map((r) => `${r.where}:${r.line}:${r.kind}`)).toEqual(['src/a.ts:2:speech', 'src/b.css:1:font'])
  })

  it('reports a history finding only on a line the commit added', () => {
    const diff = ['+++ b/src/a.ts', '@@ -0,0 +2 @@', '+window.speechSynthesis.speak(u)', '+++ b/src/b.css', '@@ -3 +3 @@', '+.m { color: red }'].join('\n')
    const rows = scanAdded(diff, read, 'abc1234')
    expect(rows).toEqual([{ where: 'abc1234 src/a.ts', line: 2, kind: 'speech', what: 'speechSynthesis' }])
  })
})
