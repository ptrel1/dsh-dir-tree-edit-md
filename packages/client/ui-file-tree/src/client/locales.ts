/** `filetree` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tree.label': '文件',
  'empty.noWorkspace': '未选择工作区',
  'loading': '加载中…',
  'error.loadFailed': '加载失败，点击重试',
  'action.copy': '复制路径',
  'action.open': '默认程序打开',
  'action.markFile': '文件编辑标记',
  'action.mark': '标记',
  'action.cancel': '取消',
  'action.deleteMarker': '删除标记',
  'action.closeFile': '关闭文件',
  'action.closeEditor': '关闭编辑器',
  'panel.label': '文件编辑标记',
  'editor.failed': '无法读取此文件（可能是二进制文件或不可读）',
  'editor.truncated': '文件过大，仅显示开头部分',
  'editor.annotationPlaceholder': '说明你想对这个文本段落做什么（例如：重构这个函数）',
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
  'action.copy': 'Copy path',
  'action.open': 'Open with default app',
  'action.markFile': 'Edit marker',
  'action.mark': 'Mark',
  'action.cancel': 'Cancel',
  'action.deleteMarker': 'Delete marker',
  'action.closeFile': 'Close file',
  'action.closeEditor': 'Close editor',
  'panel.label': 'File edit markers',
  'editor.failed': 'Cannot read this file (binary or unreadable)',
  'editor.truncated': 'File too large — showing the beginning',
  'editor.annotationPlaceholder': 'Describe what you want done with this text (e.g. refactor this function)',
  'search.aria': 'Search files',
  'search.placeholder': 'Search file names',
  'search.clear': 'Clear search',
  'search.noMatches': 'No matches found',
  'search.truncated': 'Too many results — list truncated',
  'search.failed': 'Search failed — click to retry',
} satisfies Record<FileTreeKey, string>
