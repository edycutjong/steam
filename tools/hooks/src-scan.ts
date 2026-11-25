// Hook src-scan-after-shell (PostToolUse, matcher "shell"). SKELETON: the state before hook-coverage H3; it judges nothing.

import { isMain, ok, runAsMain, type HookResult } from './lib.ts'

export const HOOK = 'src-scan'

export interface Deps {
  now?: () => Date
}

export function run(_raw: string, _deps: Deps = {}): HookResult {
  return ok()
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
