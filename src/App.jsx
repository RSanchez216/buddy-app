import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import VendorMaster from './pages/VendorMaster'
import InvoiceInbox from './pages/InvoiceInbox'
import TransactionFeed from './pages/TransactionFeed'
import MonthlyReport from './pages/MonthlyReport'
import SettingsDepartments from './pages/settings/Departments'
import SettingsVendorCategories from './pages/settings/VendorCategories'
import SettingsPaymentMethods from './pages/settings/PaymentMethods'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<Dashboard />} />
              <Route path="vendors" element={<VendorMaster />} />
              <Route path="invoices" element={<InvoiceInbox />} />
              <Route path="transactions" element={<TransactionFeed />} />
              <Route path="reports" element={<MonthlyReport />} />
              {/* Settings */}
              <Route path="settings/departments" element={<SettingsDepartments />} />
              <Route path="settings/vendor-categories" element={<SettingsVendorCategories />} />
              <Route path="settings/payment-methods" element={<SettingsPaymentMethods />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
