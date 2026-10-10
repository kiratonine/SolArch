import { describe, expect, it } from 'vitest'

import { parseViewerDownloadUrl } from './viewer-download'

describe('direct installer URL', () => {
  it('accepts a direct HTTPS exe asset and encodes spaces', () => {
    expect(parseViewerDownloadUrl(' https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch Viewer_0.1.0_x64-setup.exe '))
      .toBe('https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch%20Viewer_0.1.0_x64-setup.exe')
  })
  it.each([undefined, '', 'not a URL', 'http://host/setup.exe', 'javascript:alert(1)', 'https://sol-arch.vercel.app/download', 'https://github.com/kiratonine/SolArch/releases/tag/v0.1.0', 'https://user:pass@host/setup.exe', 'https://host/setup.exe#download'])('rejects unavailable or non-installer URL %s', value => {
    expect(parseViewerDownloadUrl(value)).toBeNull()
  })
})
