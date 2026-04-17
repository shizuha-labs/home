import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ConnectChatProvider, ChatLayout } from '@shizuha/chat'

const ACCESS_TOKEN_KEY = 'shizuha_access_token'
function getAuthToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || ''
}

export default function ChatPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to={`/id/login?continue=${encodeURIComponent(window.location.pathname)}`} replace />
  }

  const handleNavigateConversation = (id) => {
    if (id) navigate(`/c/${id}`, { replace: true })
    else navigate('/', { replace: true })
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <a href="/" className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
          <span className="text-lg">静葉</span>
          <span className="text-sm font-medium">Shizuha</span>
        </a>
        <div className="flex items-center gap-4">
          <a href="/" className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">Home</a>
          <a href="/id/logout" className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">Sign out</a>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ConnectChatProvider
          getAuthToken={getAuthToken}
          connectApiBase="/connect/api"
          initialConversationId={conversationId}
          currentUserId={user?.id}
        >
          <ChatLayout
            apiBase="/connect/api"
            getAuthToken={getAuthToken}
            onNavigateConversation={handleNavigateConversation}
          />
        </ConnectChatProvider>
      </div>
    </div>
  )
}
