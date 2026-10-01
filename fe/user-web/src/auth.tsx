import type { AuthenticatedUser, AuthResponse } from '@clinic/generated-api-types'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, setAccessToken } from './api'

type AuthState = {
  user: AuthenticatedUser | null
  restoring: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  clear: () => void
}
const AuthContext = createContext<AuthState | null>(null)
let initialRefresh: Promise<AuthResponse> | null = null

export function AuthProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient()
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const generation = useRef(0)
  const clear = useCallback(() => {
    generation.current++
    setAccessToken(null); setUser(null); setExpiresAt(null); queries.clear(); initialRefresh = null
  }, [queries])
  const apply = useCallback(async (response: AuthResponse) => {
    if (!response.data.user.roles.some((role) => role.code === 'PATIENT')) {
      await api.auth.logout().catch(() => undefined)
      throw new Error('Cổng này chỉ dành cho tài khoản bệnh nhân.')
    }
    queries.clear()
    setAccessToken(response.data.accessToken)
    setUser(response.data.user)
    setExpiresAt(Date.now() + response.data.expiresIn * 1000)
  }, [queries])
  useEffect(() => {
    let active = true
    const current = generation.current
    if (!initialRefresh) initialRefresh = api.auth.refresh()
    void initialRefresh.then((response) => { if (active && current === generation.current) return apply(response) }).catch(() => {
      if (active && current === generation.current) clear()
    }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [apply, clear])
  useEffect(() => {
    if (!user || !expiresAt) return
    const timer = window.setTimeout(() => {
      const current = generation.current
      void api.auth.refresh().then((response) => { if (current === generation.current) return apply(response) })
        .catch(() => { if (current === generation.current) clear() })
    }, Math.max(expiresAt - Date.now() - 30_000, 1000))
    return () => window.clearTimeout(timer)
  }, [user, expiresAt, apply, clear])
  const login = async (identifier: string, password: string) => {
    const current = ++generation.current
    const response = await api.auth.login({ identifier, password, clientType: 'web' })
    if (current === generation.current) await apply(response)
  }
  const logout = async () => { try { await api.auth.logout() } catch { /* Clear the local session offline too. */ } finally { clear() } }
  return <AuthContext.Provider value={{ user, restoring, login, logout, clear }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const state = useContext(AuthContext)
  if (!state) throw new Error('AuthProvider is missing')
  return state
}
