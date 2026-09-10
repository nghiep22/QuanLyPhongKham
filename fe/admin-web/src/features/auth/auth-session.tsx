import type { AuthenticatedUser, AuthResponse } from '@clinic/generated-api-types'
import { ApiClientError } from '@clinic/generated-api-client'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiClient, setAccessToken } from '../../shared/api/client'
import { AuthContext, type Credentials } from './auth-context'
let initialRefresh: Promise<AuthResponse> | null = null

function refreshInitialSession() {
  if (!initialRefresh) {
    initialRefresh = apiClient.auth.refresh()
    void initialRefresh.then(
      () => window.setTimeout(() => { initialRefresh = null }, 1_000),
      () => window.setTimeout(() => { initialRefresh = null }, 1_000),
    )
  }
  return initialRefresh
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const sessionGeneration = useRef(0)

  const applySession = useCallback((response: AuthResponse) => {
    setAccessToken(response.data.accessToken)
    setUser(response.data.user)
    setExpiresAt(Date.now() + response.data.expiresIn * 1000)
  }, [])

  const clearSession = useCallback(() => {
    sessionGeneration.current += 1
    setAccessToken(null)
    setUser(null)
    setExpiresAt(null)
    initialRefresh = null
  }, [])

  useEffect(() => {
    let active = true
    const generation = sessionGeneration.current
    void refreshInitialSession()
      .then((response) => {
        if (active && generation === sessionGeneration.current) applySession(response)
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiClientError && error.status === 401)) {
          console.error('Không thể khôi phục phiên đăng nhập.', error)
        }
      })
      .finally(() => {
        if (active) setIsRestoring(false)
      })
    return () => {
      active = false
    }
  }, [applySession])

  useEffect(() => {
    if (!expiresAt || !user) return
    const delay = Math.max(expiresAt - Date.now() - 30_000, 1_000)
    const timer = window.setTimeout(() => {
      const generation = sessionGeneration.current
      void apiClient.auth.refresh()
        .then((response) => {
          if (generation === sessionGeneration.current) applySession(response)
        })
        .catch(clearSession)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [applySession, clearSession, expiresAt, user])

  const login = useCallback(async (credentials: Credentials) => {
    const response = await apiClient.auth.login({ ...credentials, clientType: 'web' })
    applySession(response)
  }, [applySession])

  const logout = useCallback(async () => {
    try {
      await apiClient.auth.logout()
    } catch (error) {
      console.warn('Không thể xác nhận đăng xuất với máy chủ.', error)
    } finally {
      clearSession()
    }
  }, [clearSession])

  const logoutAll = useCallback(async () => {
    try {
      await apiClient.auth.logoutAll()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await apiClient.auth.changePassword({ currentPassword, newPassword })
    clearSession()
  }, [clearSession])

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    await apiClient.auth.resetPassword({ token, newPassword })
    clearSession()
  }, [clearSession])

  const value = useMemo(
    () => ({ user, isRestoring, login, logout, logoutAll, changePassword, resetPassword }),
    [user, isRestoring, login, logout, logoutAll, changePassword, resetPassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
