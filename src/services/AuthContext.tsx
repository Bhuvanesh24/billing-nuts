import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// DUMMY CREDENTIALS — replace before going live.
export const USERNAME = 'admin'
export const PASSWORD = 'admin123'

const AUTH_KEY = 'saicashews_auth'

interface AuthContextValue {
  isAuthenticated: boolean
  login: (username: string, password: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readSession(): boolean {
  try {
    return sessionStorage.getItem(AUTH_KEY) === 'true'
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(readSession)

  const login = useCallback((username: string, password: string) => {
    const ok = username.trim() === USERNAME && password === PASSWORD
    if (ok) {
      try {
        sessionStorage.setItem(AUTH_KEY, 'true')
      } catch {
        // ignore
      }
      setIsAuthenticated(true)
    }
    return ok
  }, [])

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(AUTH_KEY)
    } catch {
      // ignore
    }
    setIsAuthenticated(false)
  }, [])

  const value = useMemo(() => ({ isAuthenticated, login, logout }), [isAuthenticated, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
