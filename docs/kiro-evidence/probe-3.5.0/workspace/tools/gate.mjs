// watch-node command handler: reads stdin cursor, checks both reader files, returns terminal-state
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const a = existsSync('content/a.json'), b = existsSync('content/b.json')
appendFileSync('hooks.log', `${new Date().toISOString()}\twatch-gate\tcursor=${JSON.stringify(input.cursor)} a=${a} b=${b}\n`)
const done = a && b
process.stdout.write(JSON.stringify({ outcome: done ? 'terminal-state' : 'idle', cursor: { polls: ((input.cursor && input.cursor.polls) || 0) + 1 }, payload: JSON.stringify({ a, b, verdict: done ? 'both-readers-present' : 'waiting' }) }))
