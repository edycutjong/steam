// The note the renderer specs and scripts use: the bundle's hero note, opened through the harness route (cook-mode R15.8, R15.9).
import path from 'node:path'

export const HERO_RECIPE = 'quinces-marmalade'
export const HERO_NOTE = 'till-it-looks-red-smooth'
/** Folder of the bundle's files. */
export const HERO_DIR_FS = path.resolve(`public/recipes/${HERO_RECIPE}`)
/** The harness route; the pane's parameters (t, lead, fps) follow in the hash query, e.g. `${HERO_ROUTE}?t=2000`. */
export const HERO_ROUTE = `/#/pane/${HERO_RECIPE}/${HERO_NOTE}`
export const heroUrl = (query = ''): string => `${HERO_ROUTE}${query}`
/** URL of one StaticPane image. */
export const heroPaneImage = (kind: 'page' | 'groups', state: 'fogged' | 'held' | 'wiped'): string => `/recipes/${HERO_RECIPE}/panes/${HERO_NOTE}-${kind}-${state}.webp`
