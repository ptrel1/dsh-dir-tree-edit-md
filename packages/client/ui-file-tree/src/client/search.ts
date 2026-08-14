/**
 * Pure filtered-tree construction: rebuild the search result hierarchy
 * client-side from the host's flat match list. The virtual root is the
 * workspace root; every match becomes a real node and each missing level on
 * the path to it becomes a synthesized directory node (no git ink — it was
 * never listed). The host never ships ancestor chains, so this module owns
 * that shape.
 */
import type { FileTreeEntry, FileTreeEntryKind, FileTreeGitStatus } from '@deepseek-ai/dsh-client-runtime/client'

/** One filtered-tree node: a real match or a synthesized ancestor. */
export interface FilterTreeNode {
  path: string
  name: string
  kind: FileTreeEntryKind
  hidden: boolean
  /** Present only on real matches (synthesized ancestors carry no git state). */
  gitStatus: FileTreeGitStatus | undefined
  /** True when the node exists only to reach a deeper match. */
  synthesized: boolean
  parent: FilterTreeNode | undefined
  children: FilterTreeNode[]
}

/**
 * Strip the search root prefix; separators of both flavors count for the
 * comparison, but the returned segments come from the RAW path so rebuilt
 * node paths keep the wire separator flavor — the store keys the plain tree
 * expands and reveals by.
 */
function relativeSegments(root: string, path: string): string[] | null {
  const normalized = path.replace(/\\/g, '/')
  const prefix = root.replace(/\\/g, '/')
  const rooted = prefix.endsWith('/') ? prefix : `${prefix}/`
  if (!normalized.startsWith(rooted)) return null
  const raw = path.slice(root.length).replace(/^[/\\]+/, '')
  return raw.split(/[/\\]/)
}

/**
 * Rebuild the match hierarchy under the search root.
 * @param root - the absolute search root (session workspace root).
 * @param matches - flat host matches in walk order.
 * @returns the virtual root node (its children are the visible levels).
 */
export function buildFilteredTree(root: string, matches: readonly FileTreeEntry[]): FilterTreeNode {
  const virtual: FilterTreeNode = {
    path: root, name: '', kind: 'directory', hidden: false, gitStatus: undefined, synthesized: true, parent: undefined, children: [],
  }
  // Node paths join with the root's separator so reveal/selection keys match
  // the plain tree's wire paths exactly (Windows wire paths use backslashes).
  const separator = root.includes('\\') ? '\\' : '/'
  for (const match of matches) {
    const segments = relativeSegments(root, match.path)
    // Defensive: a match outside the root (or the root itself) cannot be placed.
    if (segments === null || segments.length === 0 || segments[0] === '') continue
    let cursor = virtual
    let joined = root
    for (const segment of segments) {
      joined = `${joined}${separator}${segment}`
      const existing = cursor.children.find(child => child.name === segment)
      if (segment === segments[segments.length - 1]) {
        // A real match replaces any synthesized placeholder at the same spot,
        // keeping the children the placeholder had already gathered.
        if (existing !== undefined) {
          existing.kind = match.kind
          existing.hidden = match.hidden
          existing.gitStatus = match.gitStatus
          existing.synthesized = false
        } else {
          cursor.children.push({
            path: joined, name: segment, kind: match.kind, hidden: match.hidden,
            gitStatus: match.gitStatus, synthesized: false, parent: cursor, children: [],
          })
        }
      } else if (existing !== undefined) {
        cursor = existing
      } else {
        const ancestor: FilterTreeNode = {
          path: joined, name: segment, kind: 'directory', hidden: false, gitStatus: undefined, synthesized: true, parent: cursor, children: [],
        }
        cursor.children.push(ancestor)
        cursor = ancestor
      }
    }
  }
  sortChildren(virtual)
  return virtual
}

/** Directories first, then locale order — the plain tree's effective row order. */
function sortChildren(node: FilterTreeNode): void {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  for (const child of node.children) sortChildren(child)
}
