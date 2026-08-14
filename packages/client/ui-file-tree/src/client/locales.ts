/** `filetree` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tree.label': '文件',
  'empty.noWorkspace': '未选择工作区',
  'loading': '加载中…',
  'error.loadFailed': '加载失败，点击重试',
  'action.copy': '复制',
  'action.open': '打开',
  'search.aria': '搜索文件',
  'search.placeholder': '搜索文件名',
  'search.clear': '清除搜索',
  'search.noMatches': '未找到匹配项',
  'search.truncated': '结果过多，已截断',
  'search.failed': '搜索失败，点击重试',
} satisfies Record<string, string>

/** The file-tree namespace key union. */
export type FileTreeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'tree.label': 'Files',
  'empty.noWorkspace': 'No workspace selected',
  'loading': 'Loading…',
  'error.loadFailed': 'Failed to load — click to retry',
  'action.copy': 'Copy',
  'action.open': 'Open',
  'search.aria': 'Search files',
  'search.placeholder': 'Search file names',
  'search.clear': 'Clear search',
  'search.noMatches': 'No matches found',
  'search.truncated': 'Too many results — list truncated',
  'search.failed': 'Search failed — click to retry',
} satisfies Record<FileTreeKey, string>
