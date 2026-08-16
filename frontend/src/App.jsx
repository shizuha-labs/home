import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GlobalNavBar from './components/shared/GlobalNavBar'
import LandingPage from './pages/LandingPage'
import ChatHome from './pages/ChatHome'
import DocsPage from './pages/DocsPage'
import BenchmarksPage from './pages/BenchmarksPage'
import ForgePage from './pages/ForgePage'
import ForgeDashboardPage from './pages/ForgeDashboardPage'
import ForgePricingPage from './pages/ForgePricingPage'
import ForgeSignupPage from './pages/ForgeSignupPage'
import ApiPage from './pages/ApiPage'
import HivePage from './pages/HivePage'
import ResearchPage from './pages/ResearchPage'
import ResearchOrderPage from './pages/ResearchOrderPage'
import DojoPage from './pages/DojoPage'
import AutonomousOrgPage from './pages/AutonomousOrgPage'
import DrivePricingPage from './pages/DrivePricingPage'
import LiveTracePage from './pages/LiveTracePage'

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
  const { pathname } = useLocation()

  if (isLoading) return <LoadingSpinner />

  const conversationRoute = pathname === '/c' || pathname.startsWith('/c/')
  if (!isAuthenticated) {
    // /c/:id must stay login-gated; `/` stays the public landing.
    if (conversationRoute) {
      window.location.href = `/id/login?continue=${encodeURIComponent(pathname)}`
      return <LoadingSpinner />
    }
    return <LandingPage />
  }

  // One shell for `/` and `/c/:id` so Live + ChatHome do not remount
  // when the operator opens a thread mid-call.
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
      <GlobalNavBar />
      <div className="flex-1 overflow-hidden pt-14">
        <ChatHome />
      </div>
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Home />}>
        <Route index element={null} />
        <Route path="c" element={null} />
        <Route path="c/:conversationId" element={null} />
      </Route>
      <Route path="/hive" element={<LandingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/benchmarks" element={<BenchmarksPage />} />
      <Route path="/forge/signup" element={<ForgeSignupPage />} />
      <Route path="/forge" element={<ForgePage />} />
      <Route path="/forge/dashboard" element={<ForgeDashboardPage />} />
      <Route path="/forge/pricing" element={<ForgePricingPage />} />
      <Route path="/api" element={<ApiPage />} />
      <Route path="/hive" element={<HivePage />} />
      <Route path="/dojo" element={<DojoPage />} />
      <Route path="/autonomous-org" element={<AutonomousOrgPage />} />
      <Route path="/research" element={<ResearchPage />} />
      <Route path="/research/order" element={<ResearchOrderPage />} />
      <Route path="/drive/pricing" element={<DrivePricingPage />} />
      <Route path="/live-trace" element={<LiveTracePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
