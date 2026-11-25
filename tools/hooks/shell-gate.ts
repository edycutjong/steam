// Hook shell-gate (PreToolUse, matcher "shell"). SKELETON: the state before hook-coverage H2; it allows every command.

import { isMain, ok, runAsMain, type HookResult } from './lib.ts'

export const HOOK = 'shell-gate'

export interface Deps {
  now?: () => Date
}

export function run(_raw: string, _deps: Deps = {}): HookResult {
  return ok()
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
