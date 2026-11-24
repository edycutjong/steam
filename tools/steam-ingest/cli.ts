// steam-ingest: fetch | segment | merge | fallback | gate | catalog (R38). Run with tsx.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { catalogCmd } from './catalog.ts'
import { fallbackCmd } from './fallback.ts'
import { fetchRecipe, fixtureGet, KNOWN, writeFetched, type Get } from './fetch.ts'
import { allRecipes, exitCodeOf, gateCmd, recipeDir, UsageError } from './gate.ts'
import { mergeCmd } from './merge.ts'
import { segmentCmd } from './segment.ts'
import { once } from './watch.ts'

const USAGE: Record<string, string> = {
  fetch: 'usage: steam-ingest fetch <recipe-id> [--from-fixture | --fallback-to-fixture] [--work <id> --canvas <n> --page <p>]',
  segment: 'usage: steam-ingest segment <recipe-id> [--block <n>]',
  merge: 'usage: steam-ingest merge <recipe-id>',
  fallback: 'usage: steam-ingest fallback <recipe-id> --structure <file>',
  gate: 'usage: steam-ingest gate <recipe-id> [--who <name>] | gate --all [--verify] | gate --once',
  catalog: 'usage: steam-ingest catalog',
}

class Bad extends Error {}
const flagNames = ['--from-fixture', '--fallback-to-fixture', '--all', '--verify', '--once']
const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Bad(`${name} needs a value`)
  return v
}
const recipeArg = (args: string[], cmd: string): string => {
  const id = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && !flagNames.includes(args[i - 1]!)))
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Bad(USAGE[cmd]!)
  return id
}

const netGet: Get = async (url) => {
  const r = await fetch(url, { redirect: 'follow' })
  return { status: r.status, body: new Uint8Array(await r.arrayBuffer()) }
}

export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const [cmd, ...args] = argv
  try {
    switch (cmd) {
      case 'fetch': {
        const id = recipeArg(args, 'fetch')
        const known = KNOWN[id]
        const t = {
          workId: flag(args, '--work') ?? known?.workId,
          canvasIndex: Number(flag(args, '--canvas') ?? known?.canvasIndex),
          page: flag(args, '--page') ?? known?.page,
        }
        if (!t.workId || !Number.isInteger(t.canvasIndex) || !t.page) throw new Bad(USAGE.fetch!)
        const fromFixture = args.includes('--from-fixture')
        let r
        let how = 'live Wellcome API'
        try {
          const retrieved = fromFixture ? 'fixture: fixtures/p0033.jpg and the recorded catalogue response, no network (--from-fixture)' : new Date().toISOString().slice(0, 10)
          r = await fetchRecipe({ workId: t.workId, canvasIndex: t.canvasIndex, page: t.page }, fromFixture ? fixtureGet(root) : netGet, retrieved)
          if (fromFixture) how = 'recorded fixtures'
        } catch (e) {
          // R4.4: a failed request fails the command, unless the caller asked for the labelled fixture fallback
          if (fromFixture || !args.includes('--fallback-to-fixture') || (e as Error).message.startsWith('licence refused')) throw e
          const net = (e as Error).message
          console.error(`fetch: network failure (${net}); using the recorded fixtures`)
          r = await fetchRecipe({ workId: t.workId, canvasIndex: t.canvasIndex, page: t.page }, fixtureGet(root), `fixture: fixtures/p0033.jpg and the recorded catalogue response; the live request failed on ${new Date().toISOString().slice(0, 10)} (${net})`)
          how = 'recorded fixtures after a network failure'
        }
        writeFetched(recipeDir(root, id), r)
        console.log(`fetch ${id}: licence ${r.licence.id} (${r.licence.label}) resolved from the catalogue record; ${r.size.width}x${r.size.height} page from ${how}; ${r.source.imageService}`)
        return 0
      }
      case 'segment': {
        const id = recipeArg(args, 'segment')
        const b = flag(args, '--block')
        if (b !== undefined && !/^\d+$/.test(b)) throw new Bad(USAGE.segment!)
        const r = segmentCmd(recipeDir(root, id), b === undefined ? {} : { block: Number(b) })
        console.log(`segment ${id}: ${r.summary}; deskew ${r.files.seg.deskewDeg} deg (${r.files.seg.deskewApplied ? 'applied' : 'recorded, not applied'}); slant ${r.files.seg.slant.s}; ${r.splits} splits; segmentRun ${r.files.lines.segmentRun.id}`)
        return 0
      }
      case 'merge': {
        const id = recipeArg(args, 'merge')
        const r = mergeCmd(recipeDir(root, id))
        console.log(r.wrote ? `merge ${id}: wrote transcription.md` : `merge ${id}: transcription.md exists and ${r.equal ? 'equals' : 'differs from'} the fresh merge; left unchanged`)
        return 0
      }
      case 'fallback': {
        const id = recipeArg(args, 'fallback')
        const s = flag(args, '--structure')
        if (!s) throw new Bad(USAGE.fallback!)
        const fb = fallbackCmd({ recipeDir: recipeDir(root, id), goldPath: join(root, 'fixtures/gold-readings.json'), goldName: 'fixtures/gold-readings.json', structurePath: resolve(root, s) })
        console.log(`fallback ${id}: wrote fallback/reading.json (${fb.lines.length} lines, ${fb.steps.length} steps, ${fb.notes.length} notes, by ${fb.by})`)
        return 0
      }
      case 'gate': {
        if (args.includes('--once')) {
          const r = once(readFileSync(0, 'utf8'))
          for (const l of r.stderr) if (l) console.error(l)
          process.stdout.write(r.stdout)
          return r.exit
        }
        const verify = args.includes('--verify')
        const ids = args.includes('--all') ? allRecipes(root) : [recipeArg(args, 'gate')]
        if (verify && !args.includes('--all')) throw new Bad(USAGE.gate!)
        let worst = 0
        for (const id of ids) {
          const r = gateCmd(id, { root, who: flag(args, '--who'), verify, noLog: verify })
          const code = exitCodeOf(r.state)
          for (const n of r.notes) console.error(`gate ${id}: ${n}`)
          if (r.state !== 'pass') console.error(`gate ${id}: ${r.state}${r.firstFailure ? `: ${r.firstFailure}` : ''}`)
          for (const [k, v] of Object.entries(r.gate.results ?? {})) if (!v.pass) console.error(`  ${k}: ${v.detail}`)
          console.log(`gate ${id}: ${r.state}${verify ? (r.changed ? ' (differs from the committed files)' : ' (matches the committed gate.json)') : r.changed ? '' : ' (no-op)'}`)
          worst = Math.max(worst, code === 3 && verify ? 3 : code)
        }
        if (verify && ids.length === 0) console.log('gate --all --verify: no recipes')
        return worst
      }
      case 'catalog': {
        const r = catalogCmd(root)
        for (const l of r.log) console.log(l)
        return r.ok ? 0 : 1
      }
      default:
        console.error(`usage: steam-ingest <${Object.keys(USAGE).join('|')}> ...`)
        return 2
    }
  } catch (e) {
    if (e instanceof Bad || e instanceof UsageError) {
      console.error(e.message)
      return 2
    }
    console.error((e as Error).stack ?? String(e))
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).then((c) => process.exit(c))
