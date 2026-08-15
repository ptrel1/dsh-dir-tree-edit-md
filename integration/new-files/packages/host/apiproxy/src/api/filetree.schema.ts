/**
 * filetree domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { FileAnnotation, FileTreeEntry } from './filetree.ts'
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

/** filetree.search request payload: the search root and the name substring. */
export const fileTreeSearchRequestSchema = z.object({
  path: z.string().min(1),
  query: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'filetree.search'>>>

/** filetree.search response value. */
export const fileTreeSearchValueSchema = z.object({
  path: z.string(),
  matches: z.array(fileTreeEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.search'>>>

/** filetree.select request payload: the session and its complete selected-path set. */
export const fileTreeSelectRequestSchema = z.object({
  sessionId: z.string(),
  files: z.array(z.string()),
}) as unknown as z.ZodType<Wire<RequestPayload<'filetree.select'>>>

/** filetree.select response value: the recorded selection. */
export const fileTreeSelectValueSchema = z.object({
  selected: z.array(z.string()),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.select'>>>

/** filetree.read request payload: the absolute file to read. */
export const fileTreeReadRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'filetree.read'>>>

/** filetree.read response value. */
export const fileTreeReadValueSchema = z.object({
  path: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  language: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.read'>>>

/** One edit-marker annotation on the wire. */
export const fileTreeAnnotationSchema = z.object({
  id: z.string(),
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  startColumn: z.number(),
  endColumn: z.number(),
  text: z.string(),
  instruction: z.string(),
  status: z.enum(['pending', 'done']),
}) satisfies z.ZodType<Wire<FileAnnotation>>

/** filetree.annotate request payload: the session and its complete marker set. */
export const fileTreeAnnotateRequestSchema = z.object({
  sessionId: z.string(),
  annotations: z.array(fileTreeAnnotationSchema),
}) as unknown as z.ZodType<Wire<RequestPayload<'filetree.annotate'>>>

/** filetree.annotate response value: the recorded marker set. */
export const fileTreeAnnotateValueSchema = z.object({
  annotations: z.array(fileTreeAnnotationSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.annotate'>>>

/** filetree.annotations request payload: the session to read markers for. */
export const fileTreeAnnotationsRequestSchema = z.object({
  sessionId: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'filetree.annotations'>>>

/** filetree.annotations response value: the session's latest marker set. */
export const fileTreeAnnotationsValueSchema = z.object({
  annotations: z.array(fileTreeAnnotationSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'filetree.annotations'>>>
