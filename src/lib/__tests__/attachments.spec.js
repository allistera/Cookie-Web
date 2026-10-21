import { describe, expect, it } from 'vitest'
import { attachmentIcon, formatFileSize } from '../attachments'

describe('attachment presentation', () => {
  it.each([
    [undefined, 'attach_file'],
    ['', 'attach_file'],
    ['image/png', 'image'],
    ['video/mp4', 'movie'],
    ['audio/mpeg', 'audiotrack'],
    ['application/pdf', 'picture_as_pdf'],
    ['application/zip', 'folder_zip'],
    ['application/x-compressed', 'folder_zip'],
    ['text/plain', 'draft'],
  ])('uses the appropriate icon for %s', (mime, icon) => {
    expect(attachmentIcon(mime)).toBe(icon)
  })

  it.each([
    [undefined, ''],
    [NaN, ''],
    [Infinity, ''],
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1572864, '1.5 MB'],
  ])('formats file size %s as %s', (bytes, formatted) => {
    expect(formatFileSize(bytes)).toBe(formatted)
  })
})
