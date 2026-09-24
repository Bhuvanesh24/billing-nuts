import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  BarChart3,
  Boxes,
  Cloud,
  CloudOff,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Package,
  Tags,
  X,
} from 'lucide-react'
import { useAuth } from '../services/AuthContext'
import { useDrive } from '../services/useDrive'
import { BUSINESS } from '../config/business'
import { cn, errorMessage } from '../lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/bills/new', label: 'Create Bill', icon: FilePlus2 },
  { to: '/bills', label: 'Bills', icon: FileText },
  { to: '/rates', label: 'Daily Rates', icon: Tags },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
]

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/bills/edit')) return 'Edit Bill'
  const match = NAV_ITEMS.find((n) => n.to === pathname)
  return match?.label ?? 'Dashboard'
}

export default function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { logout } = useAuth()
  const { isSignedIn, isInitialized, signIn, signOut, loading, error } = useDrive()
  const location = useLocation()
  const [connecting, setConnecting] = useState(false)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await signIn()
      toast.success('Google Drive connected')
    } catch (e) {
      toast.error(errorMessage(e, 'Could not connect Google Drive'))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    signOut()
    toast.success('Google Drive disconnected')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
              {BUSINESS.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{BUSINESS.name}</p>
              <p className="text-xs text-slate-500">{BUSINESS.tagline}</p>
            </div>
          </div>
          <button className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-blue-100 bg-blue-50 text-blue-700'
                    : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-semibold text-slate-900">{pageTitle(location.pathname)}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {isSignedIn ? (
              <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 py-1 pr-1 pl-3 text-xs font-medium text-emerald-700">
                <Cloud className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sync Active</span>
                <button onClick={handleDisconnect} className="rounded-full bg-white px-2 py-0.5 text-slate-600 hover:text-red-600">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 py-1 pr-1 pl-3 text-xs font-medium text-amber-700">
                <CloudOff className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Offline</span>
                <button
                  onClick={handleConnect}
                  disabled={!isInitialized || connecting}
                  className="rounded-full bg-white px-2 py-0.5 text-slate-600 hover:text-blue-600 disabled:opacity-50"
                >
                  Connect
                </button>
              </div>
            )}
            <span className="hidden text-sm font-medium text-slate-600 md:inline">{BUSINESS.name}</span>
            <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Logout">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isSignedIn ? (
            children
          ) : (
            <div className="flex min-h-[60vh] items-center justify-center">
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
                  <Cloud className="h-7 w-7 text-blue-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Connect Google Drive</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Invoices are saved to Google Drive. Connect your account to continue.
                </p>
                {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">{error}</p>}
                <button
                  onClick={handleConnect}
                  disabled={!isInitialized || connecting}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {(loading || connecting) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Loading Google…' : 'Connect Google Drive'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
