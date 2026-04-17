import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { AppSwitcher, useEnabledServices } from '@shizuha/ui'
import LandingPage from './pages/LandingPage'
import ChatHome from './pages/ChatHome'
import DocsPage from './pages/DocsPage'
import BenchmarksPage from './pages/BenchmarksPage'

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-zinc-200 border-t-cyan-500 rounded-full animate-spin dark:border-zinc-700 dark:border-t-cyan-400" />
      </div>
    </div>
  )
}

function Home() {
  const { isLoading, isAuthenticated } = useAuth()

  if (isLoading) return <LoadingSpinner />

  // Authenticated: show chat-first experience (like chatgpt.com)
  if (isAuthenticated) {
    return (
      <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
        {/* Top bar — matches landing page navbar style */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200/60 dark:border-gray-800/60 bg-white dark:bg-gray-950 relative z-50">
          <div className="flex items-center gap-2">
            <AppSwitcher currentAppId="home" popoverPosition="left" />
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">S</span>
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Shizuha</span>
            </a>
          </div>
          <div className="flex items-center gap-1">
            <a href="/docs" className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Docs</a>
            <a href="/benchmarks" className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 hidden sm:block">Benchmarks</a>
            <a href="/id/account" className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Account</a>
            <a href="/id/logout" className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Sign out</a>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatHome />
        </div>
      </div>
    )
  }

  // Unauthenticated: show landing page
  return <LandingPage />
}

function AuthGuard({ children }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <LoadingSpinner />
  if (!isAuthenticated) {
    const returnUrl = window.location.pathname
    window.location.href = `/id/login?continue=${encodeURIComponent(returnUrl)}`
    return <LoadingSpinner />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/c" element={<AuthGuard><Home /></AuthGuard>} />
      <Route path="/c/:conversationId" element={<AuthGuard><Home /></AuthGuard>} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/benchmarks" element={<BenchmarksPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
