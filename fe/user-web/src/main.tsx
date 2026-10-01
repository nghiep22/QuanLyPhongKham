import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth'
import './style.css'
import './catalog.css'
import './polish.css'

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={new QueryClient()}>
  <AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider>
</QueryClientProvider></StrictMode>)
