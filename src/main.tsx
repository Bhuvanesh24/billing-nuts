import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_GOOGLE_API_KEY',
  'VITE_GOOGLE_DRIVE_FOLDER_ID',
] as const

const root = createRoot(document.getElementById('root')!)
const missing = REQUIRED_ENV.filter((k) => !import.meta.env[k])

if (missing.length > 0) {
  // Firestore throws at import time without a projectId, so show a setup screen instead of a blank page.
  root.render(
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Setup required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to <code className="rounded bg-slate-100 px-1">.env</code>, fill in these values
          (see SETUP.md), and restart the dev server:
        </p>
        <ul className="mt-3 space-y-1 font-mono text-xs text-red-600">
          {missing.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </div>
    </div>,
  )
} else {
  import('./App').then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
}
