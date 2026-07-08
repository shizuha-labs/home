import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GlobalNavBar from './components/shared/GlobalNavBar'
import LandingPage from './pages/LandingPage'
import ChatHome from './pages/ChatHome'
import DocsPage from './pages/DocsPage'
import BenchmarksPage from './pages/BenchmarksPage'
import ForgePage from './pages/ForgePage'
import ForgeDashboardPage from './pages/ForgeDashboardPage'
import ApiPage from './pages/ApiPage'
import HivePage from './pages/HivePage'
import ResearchPage from './pages/ResearchPage'
import ResearchOrderPage from './pages/ResearchOrderPage'
import DojoPage from './pages/DojoPage'
import AutonomousOrgPage from './pages/AutonomousOrgPage'
import DrivePricingPage from './pages/DrivePricingPage'

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

  // Authenticated: show command-center experience with global nav
  if (isAuthenticated) {
    return (
      <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
        <GlobalNavBar />
        <div className="flex-1 overflow-hidden pt-14">
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
      <Route path="/hive" element={<LandingPage />} />
      <Route path="/c" element={<AuthGuard><Home /></AuthGuard>} />
      <Route path="/c/:conversationId" element={<AuthGuard><Home /></AuthGuard>} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/benchmarks" element={<BenchmarksPage />} />
      <Route path="/forge" element={<ForgePage />} />
      <Route path="/forge/dashboard" element={<ForgeDashboardPage />} />
      <Route path="/forge/pricing" element={<ForgePage />} />
      <Route path="/forge/signup" element={<ForgePage />} />
      <Route path="/api" element={<ApiPage />} />
      <Route path="/hive" element={<HivePage />} />
      <Route path="/dojo" element={<DojoPage />} />
      <Route path="/autonomous-org" element={<AutonomousOrgPage />} />
      <Route path="/research" element={<ResearchPage />} />
      <Route path="/research/order" element={<ResearchOrderPage />} />
      <Route path="/drive/pricing" element={<DrivePricingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
