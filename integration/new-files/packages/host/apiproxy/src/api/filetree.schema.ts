/**
 * filetree domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { FileTreeEntry } from './filetree.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** filetree.list request payload: the absolute directory to list. */
export const fileTreeListRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'filetree.list'>>>

/** One file-tree row shared by listing entries. */
export const fileTreeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  hidden: z.boolean(),
  gitStatus: z.enum(['modified', 'added', 'deleted', 'untracked', 'ignored']).optional(),
}) satisfies z.ZodType<Wire<FileTreeEntry>>

/** filetree.list response value. */
export const fileTreeListValueSchema = z.object({
  path: z.string(),
  entries: z.array(fileTreeEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.list'>>>

/** filetree.select request payload: the session and its complete selected-path set. */
export const fileTreeSelectRequestSchema = z.object({
  sessionId: z.string(),
  files: z.array(z.string()),
}) as unknown as z.ZodType<Wire<RequestPayload<'filetree.select'>>>

/** filetree.select response value: the recorded selection. */
export const fileTreeSelectValueSchema = z.object({
  selected: z.array(z.string()),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.select'>>>
