import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { LayoutDashboard, Cpu, ListChecks, Shield, Search, Menu, X, LogOut } from 'lucide-react'
import ThemeToggle from '../ThemeToggle'
import { AppSwitcher } from '@shizuha/ui'
import { useAuth } from '../../contexts/AuthContext'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, surface: 'home' },
  // Logged-in users clicking Agents expect THEIR agents, not the hive
  // landing (operator 2026-07-10) — deep-link straight to the fleet list.
  { label: 'Agents', href: '/hive/agents', icon: Cpu, surface: 'hive', match: '/hive' },
  { label: 'Work', href: '/pulse', icon: ListChecks, surface: 'pulse' },
  { label: 'Admin', href: '/admin', icon: Shield, surface: 'admin' },
]

export default function GlobalNavBar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { isAuthenticated, user } = useAuth()
  const location = useLocation()

  const currentSurface = NAV_ITEMS.find(
    item => location.pathname === item.href || location.pathname.startsWith((item.match || item.href) + '/') || location.pathname === item.match
  )?.surface || 'home'

  const handleLogout = () => {
    window.location.href = '/id/logout'
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-[var(--z-navbar)] bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo + Nav Items */}
          <div className="flex items-center gap-1">
            <div className="mr-2">
              <AppSwitcher currentAppId={currentSurface} variant="compact" enableShortcuts popoverPosition="left" />
            </div>
            <a href="/" className="flex items-center gap-2 mr-4">
              <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">S</span>
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-white hidden sm:block">
                Shizuha
              </span>
            </a>

            {/* Desktop Nav Items */}
            <div className="hidden md:flex items-center gap-0.5">
              {NAV_ITEMS.map(item => {
                const isActive = item.surface === currentSurface
                return (
                  <a
                    key={item.surface}
                    href={item.href}
                    className={`
                      flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150
                      ${isActive
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'
                      }
                    `}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </a>
                )
              })}
            </div>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
              title="Search (Ctrl+K)"
            >
              <Search className="h-4 w-4" />
            </button>

            <ThemeToggle />

            {/* Desktop User Menu */}
            <div className="hidden md:flex items-center gap-2 ml-2">
              {isAuthenticated ? (
                <>
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                    <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center">
                      <span className="text-brand-700 dark:text-brand-300 text-xs font-medium">
                        {(user?.first_name?.[0] || user?.username?.[0] || 'U').toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300 hidden lg:block">
                      {user?.first_name || user?.username}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <a href="/id/login" className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors">
                    Sign in
                  </a>
                  <a href="/id/register" className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors">
                    Get Started
                  </a>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="flex md:hidden items-center">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? (
                  <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                ) : (
                  <Menu className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 animate-fade-in">
          <div className="px-4 py-3 space-y-1">
            {NAV_ITEMS.map(item => {
              const isActive = item.surface === currentSurface
              return (
                <a
                  key={item.surface}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                    }
                  `}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </a>
              )
            })}
            <hr className="border-gray-200 dark:border-gray-800 my-2" />
            {isAuthenticated ? (
              <>
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center">
                    <span className="text-brand-700 dark:text-brand-300 text-sm font-medium">
                      {(user?.first_name?.[0] || user?.username?.[0] || 'U').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {user?.first_name || user?.username}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <LogOut className="h-5 w-5" />
                  Sign out
                </button>
              </>
            ) : (
              <>
                <a href="/id/login" className="block px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                  Sign in
                </a>
                <a href="/id/register" className="block px-3 py-2.5 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 text-center">
                  Get Started
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* Search Overlay */}
      {isSearchOpen && (
        <div className="absolute top-14 left-0 right-0 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shadow-lg animate-fade-in">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search across Shizuha... (Ctrl+K)"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsSearchOpen(false)
                }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 px-1">
              Search agents, tasks, teams, and more across all surfaces
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
