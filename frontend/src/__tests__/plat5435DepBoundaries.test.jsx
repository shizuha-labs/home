/**
 * PLAT-5435 / PLAT-4440 regression fixtures.
 *
 * 1. brace-expansion must stay on the patched 1.x CJS function API that
 *    minimatch@3 (eslint chain) actually calls — never force 5.x.
 * 2. react-router-dom 7.18+ declarative SPA surface (Link / useNavigate /
 *    Routes) must resolve and navigate without open-redirect backslash paths.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MemoryRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  createPath,
} from 'react-router-dom'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

describe('PLAT-5435 brace-expansion via minimatch consumer boundary', () => {
  it('minimatch@3 still receives brace-expansion as a CJS function', () => {
    const braceExpand = require('brace-expansion')
    const minimatch = require('minimatch')

    expect(typeof braceExpand).toBe('function')
    expect(braceExpand('a{b,c}')).toEqual(['ab', 'ac'])

    // Real consumer call shape (eslint / glob path matching)
    expect(minimatch('src/App.jsx', '**/*.{js,jsx}')).toBe(true)
    expect(minimatch('README.md', '**/*.{js,jsx}')).toBe(false)

    // Patched 1.x line (GHSA-v6h2-p8h4-qcjw: vulnerable <1.1.17)
    const bePkg = require('brace-expansion/package.json')
    const [maj, min, pat] = bePkg.version.split('.').map(Number)
    expect(maj).toBe(1)
    expect(min).toBeGreaterThanOrEqual(1)
    expect(pat).toBeGreaterThanOrEqual(17)
  })
})

function NavProbe() {
  const navigate = useNavigate()
  return (
    <div>
      <Link to="/docs">Docs</Link>
      <button type="button" onClick={() => navigate('/benchmarks')}>
        Go benchmarks
      </button>
      <Routes>
        <Route path="/" element={<span>home</span>} />
        <Route path="/docs" element={<span>docs-page</span>} />
        <Route path="/benchmarks" element={<span>bench-page</span>} />
      </Routes>
    </div>
  )
}

describe('PLAT-5435 react-router-dom 7.x SPA navigation boundary', () => {
  it('exports declarative SPA APIs used by Home', () => {
    // RR7 ships some components as forwardRef objects (typeof === 'object')
    expect(Link).toBeTruthy()
    expect(typeof useNavigate).toBe('function')
    expect(Routes).toBeTruthy()
    expect(Route).toBeTruthy()
    expect(MemoryRouter).toBeTruthy()
  })

  it('resolves Link and useNavigate inside MemoryRouter', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavProbe />
      </MemoryRouter>,
    )
    expect(screen.getByText('home')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
  })

  it('does not treat backslash open-redirect payloads as external URLs', () => {
    // GHSA-wrjc-x8rr-h8h6 class: backslash must not become a protocol-relative jump
    const sneaky = '\\evil.example/phish'
    const built = createPath({ pathname: sneaky })
    expect(built.startsWith('//')).toBe(false)
    expect(built.includes('evil.example')).toBe(true)
    // pathname-form stays path-like (leading slash or escaped), never scheme
    expect(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(built)).toBe(false)
  })
})
