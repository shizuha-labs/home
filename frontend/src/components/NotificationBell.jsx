import { useState, useEffect, useRef, useCallback } from 'react'
import { Avatar } from '@shizuha/chat'

const ACCESS_TOKEN_KEY = 'shizuha_access_token'

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [requests, setRequests] = useState([])
  const [actionInProgress, setActionInProgress] = useState(null)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

  const getToken = () => localStorage.getItem(ACCESS_TOKEN_KEY) || ''

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/connect/api/connections/requests/', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (res.ok) {
        const data = await res.json()
        setRequests(Array.isArray(data) ? data : data.results ?? [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchRequests()
    // Poll every 30s for new requests
    const interval = setInterval(fetchRequests, 30000)
    return () => clearInterval(interval)
  }, [fetchRequests])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [isOpen])

  const acceptRequest = async (requestId, requesterId) => {
    setActionInProgress(`accept-${requestId}`)
    try {
      const res = await fetch(`/connect/api/connections/${requestId}/accept/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        setRequests(prev => prev.filter(r => r.id !== requestId))
      }
    } catch { /* ignore */ }
    setActionInProgress(null)
  }

  const rejectRequest = async (requestId) => {
    setActionInProgress(`reject-${requestId}`)
    try {
      await fetch(`/connect/api/connections/${requestId}/reject/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      })
      setRequests(prev => prev.filter(r => r.id !== requestId))
    } catch { /* ignore */ }
    setActionInProgress(null)
  }

  const count = requests.length

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${isOpen ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
        title="Notifications"
      >
        <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-white dark:ring-gray-950">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div className="fixed inset-0 z-40 bg-black/10 lg:hidden" onClick={() => setIsOpen(false)} />

          <div
            ref={popoverRef}
            className="absolute right-0 top-full mt-2 z-50 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
              {count > 0 && (
                <span className="text-xs text-gray-400">{count} pending</span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {count === 0 ? (
                <div className="py-8 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                  </svg>
                  <p className="text-sm text-gray-400 dark:text-gray-500">No notifications</p>
                </div>
              ) : (
                requests.map((req) => (
                  <div key={req.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div className="flex items-start gap-3">
                      <Avatar name={req.requester_name || `User ${req.requester_id}`} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100">
                          <span className="font-semibold">{req.requester_name || `User ${req.requester_id}`}</span>
                          {' '}wants to connect
                        </p>
                        {req.message && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{req.message}</p>
                        )}
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          {new Date(req.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => acceptRequest(req.id, req.requester_id)}
                            disabled={actionInProgress === `accept-${req.id}`}
                            className="px-3 py-1 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => rejectRequest(req.id)}
                            disabled={actionInProgress === `reject-${req.id}`}
                            className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
