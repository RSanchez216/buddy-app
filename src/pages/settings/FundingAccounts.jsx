// Settings → Funding & Sources
//
// Route stays /settings/funding-accounts for backwards compatibility.
// The page hosts two sections: Bank Accounts and Factoring Companies.

import BankAccountsSection from './funding/BankAccountsSection'
import FactoringCompaniesSection from './funding/FactoringCompaniesSection'

export default function SettingsFundingAndSources() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funding & Sources</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Bank accounts that fund payments, plus factoring companies that advance against your invoices.
        </p>
      </div>

      <BankAccountsSection />
      <FactoringCompaniesSection />
    </div>
  )
}
