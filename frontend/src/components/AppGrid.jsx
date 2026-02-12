import {
  HeartPulse,
  StickyNote,
  BookOpen,
  Package,
  Mail,
  Cloud,
  UserCircle,
  Building2,
  HardDrive,
  Users,
  Wallet,
  Calculator,
  UserCog,
  Clock,
  Bot,
  ArrowRight,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { SHIZUHA_APPS, useEnabledServices } from '@shizuha/ui'

const ICON_MAP = {
  HeartPulse,
  StickyNote,
  BookOpen,
  Package,
  Mail,
  Cloud,
  UserCircle,
  Building2,
  HardDrive,
  Users,
  Wallet,
  Calculator,
  UserCog,
  Clock,
  Bot,
}

// Services that are always visible in the app grid
const ALWAYS_VISIBLE = new Set(['admin', 'id'])

function AppCard({ app }) {
  const IconComponent = ICON_MAP[app.icon]

  return (
    <a
      href={app.path}
      className={cn(
        'group relative p-6 rounded-2xl transition-all duration-300',
        'bg-white dark:bg-gray-900',
        'border border-gray-200 dark:border-gray-800',
        'hover:border-brand-300 dark:hover:border-brand-700',
        'hover:shadow-lg hover:shadow-brand-500/10',
        'hover:-translate-y-1',
        'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
            'transition-transform duration-300 group-hover:scale-110',
            app.bgColor
          )}
        >
          <IconComponent className="h-6 w-6 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            {app.name}
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-brand-500" />
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {app.description}
          </p>
        </div>
      </div>
    </a>
  )
}

export default function AppGrid() {
  const enabledServices = useEnabledServices()

  const visibleApps = enabledServices
    ? SHIZUHA_APPS.filter(app => ALWAYS_VISIBLE.has(app.id) || enabledServices.includes(app.id))
    : SHIZUHA_APPS

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-stagger">
      {visibleApps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </div>
  )
}
