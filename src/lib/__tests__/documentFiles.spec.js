import { describe, expect, it } from 'vitest'
import {
  fileFolderKey,
  fileIcon,
  fileKind,
  folderBreadcrumb,
  folderContents,
  formatBytes,
  isPreviewable,
} from '../documentFiles'

const FOLDERS = [
  { id: 'f-a', parent_id: null, title: 'Work' },
  { id: 'f-b', parent_id: 'f-a', title: '2026' },
  { id: 'f-c', parent_id: null, title: 'Archive' },
]

describe('documentFiles helpers', () => {
  it('keys the root as root', () => {
    expect(fileFolderKey(null)).toBe('root')
    expect(fileFolderKey('f-a')).toBe('f-a')
  })

  it('previews only images and PDFs', () => {
    expect(isPreviewable('image/png')).toBe(true)
    expect(isPreviewable('application/pdf')).toBe(true)
    expect(isPreviewable('application/zip')).toBe(false)
    expect(isPreviewable('image/svg+xml')).toBe(false)
  })

  it('labels and icons by type', () => {
    expect(fileKind('image/jpeg')).toBe('Image')
    expect(fileKind('application/pdf')).toBe('PDF')
    expect(fileKind('text/csv')).toBe('Spreadsheet')
    expect(fileKind('text/plain')).toBe('Text')
    expect(fileKind('application/zip')).toBe('Archive')
    expect(fileKind('audio/mpeg')).toBe('Audio')
    expect(fileKind('video/mp4')).toBe('Video')
    expect(fileKind('application/octet-stream')).toBe('File')
    expect(fileIcon('application/pdf')).toBe('picture_as_pdf')
    expect(fileIcon('application/octet-stream')).toBe('draft')
  })

  it('formats bytes', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(3481)).toBe('3.4 KB')
    expect(formatBytes(1_258_291)).toBe('1.2 MB')
  })

  it('orders folders first, then documents and files by name', () => {
    const docs = [
      { id: 'd-1', folder_id: 'f-a', title: 'zeta' },
      { id: 'd-2', folder_id: 'f-a', title: '' },
      { id: 'd-3', folder_id: null, title: 'elsewhere' },
    ]
    const files = [{ id: 'x-1', folder_id: 'f-a', name: 'Alpha.pdf' }]
    const items = folderContents(FOLDERS, docs, files, 'f-a')
    expect(items.map((item) => [item.kind, item.name])).toEqual([
      ['folder', '2026'],
      ['file', 'Alpha.pdf'],
      ['document', 'Untitled'],
      ['document', 'zeta'],
    ])
  })

  it('lists root folders and root items for the root', () => {
    const items = folderContents(FOLDERS, [{ id: 'd', folder_id: null, title: 'r' }], [], null)
    expect(items.map((item) => item.name)).toEqual(['Archive', 'Work', 'r'])
  })

  it('builds a breadcrumb from the root down', () => {
    expect(folderBreadcrumb(FOLDERS, 'f-b').map((c) => c.title)).toEqual([
      'Documents',
      'Work',
      '2026',
    ])
    expect(folderBreadcrumb(FOLDERS, null)).toEqual([{ id: null, title: 'Documents' }])
    expect(folderBreadcrumb(FOLDERS, 'missing')).toEqual([{ id: null, title: 'Documents' }])
  })
})
