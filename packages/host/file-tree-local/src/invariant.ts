/** Package-owned invariant companion for the file-tree local backend. @module @deepseek-ai/dsh-host-file-tree-local/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-file-tree-local'

/** Cordis companion plugin name. */
export const name = 'host-file-tree-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this backend observes the host filesystem and git
 * through seams whose own packages own their invariants, and a duplicate
 * `ctx.fileTree` registration is cordis' standard duplicate-service error.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the file-tree local-backend invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
