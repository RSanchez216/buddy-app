import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
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
import SettingsLoanEntities from './pages/settings/LoanEntities'
import SettingsCarriers from './pages/settings/Carriers'
import SettingsLoanLenders from './pages/settings/LoanLenders'
import SettingsFundingAccounts from './pages/settings/FundingAccounts'
import SettingsEquipmentTypes from './pages/settings/EquipmentTypes'
import SettingsExpenseCategories from './pages/settings/ExpenseCategories'
import SettingsFactors from './pages/settings/Factors'
import SettingsRecurringExpenses from './pages/settings/RecurringExpenses'
import SettingsUsers from './pages/settings/users/Users'
import DebtSchedule from './pages/financial-controls/DebtSchedule'
import LoanDetail from './pages/financial-controls/LoanDetail'
import DriverPurchasesPage from './pages/driver-purchases/DriverPurchasesPage'
import DriverPurchaseDetail from './pages/driver-purchases/DriverPurchaseDetail'
import SettingsDriverPurchaseStatuses from './pages/settings/DriverPurchaseStatusesSettings'
import NotificationsPage from './pages/Notifications'
import PaymentCalendar from './pages/cash-flow/PaymentCalendar'
import TrucksList from './pages/fleet/TrucksList'
import TrailersList from './pages/fleet/TrailersList'
import TruckDetail from './pages/fleet/TruckDetail'
import TrailerDetail from './pages/fleet/TrailerDetail'
import DriversList from './pages/fleet/DriversList'
import DriverDetail from './pages/fleet/DriverDetail'
import FleetCost from './pages/fleet/FleetCost'
import LoadsImport from './pages/fleet/loads/LoadsImport'
import Profitability from './pages/fleet/loads/Profitability'
import SetPassword from './pages/auth/SetPassword'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/set-password" element={<SetPassword />} />
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
              {/* Fleet Inventory */}
              <Route path="fleet/trucks" element={<TrucksList />} />
              <Route path="fleet/trucks/:id" element={<TruckDetail />} />
              <Route path="fleet/trailers" element={<TrailersList />} />
              <Route path="fleet/trailers/:id" element={<TrailerDetail />} />
              <Route path="fleet/drivers" element={<DriversList />} />
              <Route path="fleet/drivers/:id" element={<DriverDetail />} />
              <Route path="fleet/cost" element={<FleetCost />} />
              <Route path="fleet/loads/import" element={<LoadsImport />} />
              <Route path="fleet/profitability" element={<Profitability />} />
              {/* Financial Controls */}
              <Route path="financial-controls/debt-schedule" element={<DebtSchedule />} />
              <Route path="financial-controls/debt-schedule/:loanId" element={<LoanDetail />} />
              <Route path="financial-controls/driver-purchases" element={<DriverPurchasesPage />} />
              <Route path="financial-controls/driver-purchases/:id" element={<DriverPurchaseDetail />} />
              <Route path="notifications" element={<NotificationsPage />} />
              {/* Cash Flow */}
              <Route path="cash-flow/payment-calendar" element={<PaymentCalendar />} />
              {/* Settings */}
              <Route path="settings/departments" element={<SettingsDepartments />} />
              <Route path="settings/vendor-categories" element={<SettingsVendorCategories />} />
              <Route path="settings/payment-methods" element={<SettingsPaymentMethods />} />
              <Route path="settings/loan-entities" element={<SettingsLoanEntities />} />
              <Route path="settings/carriers" element={<SettingsCarriers />} />
              <Route path="settings/loan-lenders" element={<SettingsLoanLenders />} />
              <Route path="settings/funding-accounts" element={<SettingsFundingAccounts />} />
              <Route path="settings/equipment-types" element={<SettingsEquipmentTypes />} />
              <Route path="settings/expense-categories" element={<SettingsExpenseCategories />} />
              <Route path="settings/factors" element={<SettingsFactors />} />
              <Route path="settings/recurring-expenses" element={<SettingsRecurringExpenses />} />
              <Route path="settings/driver-purchase-statuses" element={<SettingsDriverPurchaseStatuses />} />
              <Route path="settings/users" element={<SettingsUsers />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
