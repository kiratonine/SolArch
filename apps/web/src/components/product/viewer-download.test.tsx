import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithI18n } from '@/test/render'

import { ViewerDownloadButton } from './viewer-download'

// Public URL shape only; no test download is presented as a published release.
vi.mock('@/lib/viewer-download', () => ({
  VIEWER_DOWNLOAD_URL: 'https://github.com/kiratonine/SolArch/releases/download/test-only/viewer.exe',
  VIEWER_INSTALLER_NAME: 'SolArch Viewer_0.1.0_x64-setup.exe',
}))

describe('published installer CTA', () => {
  it('uses the direct asset, not the download webpage, without auto navigation', () => {
    renderWithI18n(<ViewerDownloadButton installer />)
    const link = screen.getByRole('link', { name: /Download for Windows/ })
    expect(link).toHaveAttribute('href', 'https://github.com/kiratonine/SolArch/releases/download/test-only/viewer.exe')
    expect(link).toHaveAttribute('download')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
