import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import ProtectedRoute from './components/ProtectedRoute'
import RequirePageAccess from './components/RequirePageAccess'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
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
import SettingsLayout from './pages/settings/SettingsLayout'
import AcceptInvite from './pages/AcceptInvite'
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
import DriverDetail from './pages/fleet/DriverDetail'
import FleetCost from './pages/fleet/FleetCost'
import SettlementsImport from './pages/fleet/settlements/SettlementsImport'
import FuelPrices from './pages/fleet/fuel-prices/FuelPrices'
import Profitability from './pages/fleet/loads/Profitability'
import Spotlight from './pages/fleet/loads/spotlight/Spotlight'
import Contribution from './pages/fleet/loads/contribution/Contribution'
import IdleReview from './pages/fleet/loads/idle/IdleReview'
import SetPassword from './pages/auth/SetPassword'
import SmartLanding from './pages/SmartLanding'

// Lazy — the lane map carries its own geo data (US outline + city
// coordinates), so it loads as a separate chunk only when visited.
const LaneFlowMap = lazy(() => import('./pages/fleet/loads/lanes/LaneFlowMap'))
// Lazy — the Boardroom pulls several rollups plus the lane and contribution
// data layers at once; keep it out of the main bundle.
const Boardroom = lazy(() => import('./pages/fleet/loads/boardroom/Boardroom'))
// Lazy — the Settings hub consolidates 9 reference-data screens; keep it
// out of the main bundle as a navigation hub.
const CombinedLoads = lazy(() => import('./pages/fleet/combined-loads/CombinedLoads'))
const SettingsHub = lazy(() => import('./pages/settings/SettingsHub'))
// Lazy — Lifeline is a destination screen (chart engine + animations), not a
// daily-driver list; keep the main bundle lean.
const Lifeline = lazy(() => import('./pages/cash-flow/lifeline/Lifeline'))
// Lazy — Debt Schedule pulls SheetJS on export (dynamic import) and is its own
// destination; split it into its own chunk off the main bundle.
const DebtSchedule = lazy(() => import('./pages/financial-controls/DebtSchedule'))
// Lazy — the Loads importer statically pulls SheetJS (xlsx) to parse workbooks;
// splitting it keeps that heavy lib out of the main bundle.
const LoadsImport = lazy(() => import('./pages/fleet/loads/LoadsImport'))
// Lazy — Drivers list (its Upload modal statically pulls SheetJS) ships as its
// own chunk.
const DriversList = lazy(() => import('./pages/fleet/DriversList'))
// Lazy — Command Center is a standalone daily surface; its own chunk.
const CommandCenter = lazy(() => import('./pages/command-center/CommandCenter'))
// Lazy — The Rig carries the whole three.js stack; it must never weigh on
// any other route. Standalone preview, direct URL only (no nav entry yet).
const RigPage = lazy(() => import('./pages/rig/RigPage'))

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/set-password" element={<SetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/rig" element={
              <ProtectedRoute>
                <Suspense fallback={
                  <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[#05060d]">
                    <div className="h-3 w-3 rounded-full bg-[#e9c984] animate-ping" />
                    <div className="text-[11px] tracking-[0.35em] text-[#e9c984] font-mono">LOADING THE RIG…</div>
                  </div>
                }>
                  <RigPage />
                </Suspense>
              </ProtectedRoute>
            } />
            <Route path="/" element={
              <ProtectedRoute>
                <SmartLanding />
              </ProtectedRoute>
            } />
            <Route path="/no-access" element={
              <ProtectedRoute>
                <NoAccess />
              </ProtectedRoute>
            } />
            <Route path="/" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route path="command-center" element={
                <RequirePageAccess pageKey="command_center">
                  <ErrorBoundary label="the Command Center">
                    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>}>
                      <CommandCenter />
                    </Suspense>
                  </ErrorBoundary>
                </RequirePageAccess>
              } />
              <Route path="dashboard" element={<RequirePageAccess pageKey="dashboard"><Dashboard /></RequirePageAccess>} />
              <Route path="vendors" element={<RequirePageAccess pageKey="vendors"><VendorMaster /></RequirePageAccess>} />
              <Route path="invoices" element={<RequirePageAccess pageKey="invoices"><InvoiceInbox /></RequirePageAccess>} />
              <Route path="transactions" element={<RequirePageAccess pageKey="transactions"><TransactionFeed /></RequirePageAccess>} />
              <Route path="reports" element={<RequirePageAccess pageKey="reports"><MonthlyReport /></RequirePageAccess>} />
              {/* Fleet Inventory */}
              <Route path="fleet/trucks" element={<RequirePageAccess pageKey="fleet/trucks"><TrucksList /></RequirePageAccess>} />
              <Route path="fleet/trucks/:id" element={<RequirePageAccess pageKey="fleet/trucks"><TruckDetail /></RequirePageAccess>} />
              <Route path="fleet/trailers" element={<RequirePageAccess pageKey="fleet/trailers"><TrailersList /></RequirePageAccess>} />
              <Route path="fleet/trailers/:id" element={<RequirePageAccess pageKey="fleet/trailers"><TrailerDetail /></RequirePageAccess>} />
              <Route path="fleet/drivers" element={
                <RequirePageAccess pageKey="fleet/drivers">
                  <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>}>
                    <DriversList />
                  </Suspense>
                </RequirePageAccess>
              } />
              <Route path="fleet/drivers/:id" element={<RequirePageAccess pageKey="fleet/drivers"><DriverDetail /></RequirePageAccess>} />
              <Route path="fleet/cost" element={<RequirePageAccess pageKey="fleet/cost"><FleetCost /></RequirePageAccess>} />
              <Route path="fleet/loads/import" element={
                <RequirePageAccess pageKey="fleet/loads/import">
                  <ErrorBoundary label="Loads Import">
                    <Suspense fallback={<div className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>}>
                      <LoadsImport />
                    </Suspense>
                  </ErrorBoundary>
                </RequirePageAccess>
              } />
              <Route path="fleet/settlements/import" element={<RequirePageAccess pageKey="fleet/settlements/import"><SettlementsImport /></RequirePageAccess>} />
              <Route path="fleet/fuel-prices" element={<RequirePageAccess pageKey="fleet/fuel-prices"><FuelPrices /></RequirePageAccess>} />
              <Route path="fleet/profitability" element={<RequirePageAccess pageKey="fleet/profitability"><Profitability /></RequirePageAccess>} />
              <Route path="fleet/profitability/boardroom" element={
                <RequirePageAccess pageKey="fleet/profitability/boardroom">
                  <Suspense fallback={<div className="p-8 text-sm text-gray-400 dark:text-slate-500">Loading the Boardroom…</div>}>
                    <Boardroom />
                  </Suspense>
                </RequirePageAccess>
              } />
              <Route path="fleet/profitability/spotlight" element={<RequirePageAccess pageKey="fleet/profitability/spotlight"><Spotlight dimension="driver" /></RequirePageAccess>} />
              <Route path="fleet/profitability/contribution" element={<RequirePageAccess pageKey="fleet/profitability/contribution"><Contribution /></RequirePageAccess>} />
              <Route path="fleet/profitability/idle" element={<RequirePageAccess pageKey="idle_review"><ErrorBoundary label="Idle review"><IdleReview /></ErrorBoundary></RequirePageAccess>} />
              <Route path="fleet/profitability/lanes" element={
                <RequirePageAccess pageKey="fleet/profitability/lanes">
                  <Suspense fallback={<div className="p-8 text-sm text-gray-400 dark:text-slate-500">Loading lane map…</div>}>
                    <LaneFlowMap />
                  </Suspense>
                </RequirePageAccess>
              } />
              <Route path="fleet/combined-loads" element={
                <RequirePageAccess pageKey="fleet/combined-loads">
                  <Suspense fallback={<div className="p-8 text-sm text-gray-400 dark:text-slate-500">Loading combined loads…</div>}>
                    <CombinedLoads />
                  </Suspense>
                </RequirePageAccess>
              } />
              {/* Financial Controls */}
              <Route path="financial-controls/debt-schedule" element={
                <RequirePageAccess pageKey="financial-controls/debt-schedule">
                  <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>}>
                    <DebtSchedule />
                  </Suspense>
                </RequirePageAccess>
              } />
              <Route path="financial-controls/debt-schedule/:loanId" element={<RequirePageAccess pageKey="financial-controls/debt-schedule"><LoanDetail /></RequirePageAccess>} />
              <Route path="financial-controls/driver-purchases" element={<RequirePageAccess pageKey="financial-controls/driver-purchases"><DriverPurchasesPage /></RequirePageAccess>} />
              <Route path="financial-controls/driver-purchases/:id" element={<RequirePageAccess pageKey="financial-controls/driver-purchases"><DriverPurchaseDetail /></RequirePageAccess>} />
              <Route path="notifications" element={<NotificationsPage />} />
              {/* Cash Flow */}
              <Route path="cash-flow/payment-calendar" element={<RequirePageAccess pageKey="cash-flow/payment-calendar"><PaymentCalendar /></RequirePageAccess>} />
              <Route path="cash-flow/lifeline" element={
                <RequirePageAccess pageKey="cash-flow/lifeline">
                  <Suspense fallback={<div className="p-8 text-sm text-gray-400 dark:text-slate-500">Loading Lifeline…</div>}>
                    <Lifeline />
                  </Suspense>
                </RequirePageAccess>
              } />
              {/* Settings */}
              <Route path="settings">
                <Route index element={
                  <Suspense fallback={<div className="p-8 text-sm text-gray-400 dark:text-slate-500">Loading Settings…</div>}>
                    <SettingsHub />
                  </Suspense>
                } />
                <Route element={<SettingsLayout />}>
                  <Route path="departments" element={<SettingsDepartments />} />
                  <Route path="vendor-categories" element={<SettingsVendorCategories />} />
                  <Route path="payment-methods" element={<SettingsPaymentMethods />} />
                  <Route path="loan-entities" element={<SettingsLoanEntities />} />
                  <Route path="carriers" element={<SettingsCarriers />} />
                  <Route path="loan-lenders" element={<SettingsLoanLenders />} />
                  <Route path="funding-accounts" element={<SettingsFundingAccounts />} />
                  <Route path="equipment-types" element={<SettingsEquipmentTypes />} />
                  <Route path="expense-categories" element={<SettingsExpenseCategories />} />
                  <Route path="factors" element={<SettingsFactors />} />
                  <Route path="recurring-expenses" element={<SettingsRecurringExpenses />} />
                  <Route path="driver-purchase-statuses" element={<SettingsDriverPurchaseStatuses />} />
                  <Route path="users" element={<SettingsUsers />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/fleet/profitability/lanes" replace />} />
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
