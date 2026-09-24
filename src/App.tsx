import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './services/AuthContext'
import { DriveProvider } from './services/DriveContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CreateBill from './pages/CreateBill'
import BillList from './pages/BillList'
import DailyRates from './pages/DailyRates'
import Inventory from './pages/Inventory'
import Products from './pages/Products'
import Reports from './pages/Reports'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <AuthProvider>
      <DriveProvider>
        <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/bills/new" element={<ProtectedRoute><CreateBill /></ProtectedRoute>} />
            <Route path="/bills/edit/:id" element={<ProtectedRoute><CreateBill /></ProtectedRoute>} />
            <Route path="/bills" element={<ProtectedRoute><BillList /></ProtectedRoute>} />
            <Route path="/rates" element={<ProtectedRoute><DailyRates /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </DriveProvider>
    </AuthProvider>
  )
}
