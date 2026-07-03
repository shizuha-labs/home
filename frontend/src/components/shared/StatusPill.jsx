const STATUS_VARIANTS = {
  running: { bg: 'bg-success-bg', text: 'text-success', dot: 'bg-success' },
  online: { bg: 'bg-success-bg', text: 'text-success', dot: 'bg-success' },
  busy: { bg: 'bg-warning-bg', text: 'text-warning', dot: 'bg-warning' },
  degraded: { bg: 'bg-warning-bg', text: 'text-warning', dot: 'bg-warning' },
  error: { bg: 'bg-error-bg', text: 'text-error', dot: 'bg-error' },
  offline: { bg: 'bg-error-bg', text: 'text-error', dot: 'bg-error' },
  idle: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400 dark:bg-gray-500' },
  stopped: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400 dark:bg-gray-500' },
  pending: { bg: 'bg-info-bg', text: 'text-info', dot: 'bg-info' },
}

export default function StatusPill({ status, label, size = 'sm' }) {
  const variant = STATUS_VARIANTS[status] || STATUS_VARIANTS.idle
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-2.5 py-1 text-sm'

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium
        ${variant.bg} ${variant.text} ${sizeClasses}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${variant.dot}`} />
      {label || status}
    </span>
  )
}
