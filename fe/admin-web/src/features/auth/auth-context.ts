import type { AuthenticatedUser } from '@clinic/generated-api-types'
import { createContext, useContext } from 'react'

export type Credentials = { identifier: string; password: string }
export type AuthContextValue = {
  user: AuthenticatedUser | null
  isRestoring: boolean
  login: (credentials: Credentials) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth phải được dùng bên trong AuthProvider.')
  return context
}
