export interface DriveConfig {
  clientId: string
  apiKey: string
  folderId: string
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`)
  }
  return value
}

export function getDriveConfig(): DriveConfig {
  const config = {
    clientId: required('VITE_GOOGLE_CLIENT_ID', import.meta.env.VITE_GOOGLE_CLIENT_ID),
    apiKey: required('VITE_GOOGLE_API_KEY', import.meta.env.VITE_GOOGLE_API_KEY),
    folderId: required('VITE_GOOGLE_DRIVE_FOLDER_ID', import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID),
  }
  // Common mix-up: the OAuth client secret (GOCSPX-…) pasted as the API key. The secret must
  // never be used in a browser app. API keys start with "AIza".
  if (config.apiKey.startsWith('GOCSPX-')) {
    throw new Error(
      'VITE_GOOGLE_API_KEY contains the OAuth client SECRET, not an API key. Create an API key (starts with "AIza") under Google Cloud → Credentials, and reset the leaked client secret.',
    )
  }
  if (!config.clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error('VITE_GOOGLE_CLIENT_ID should end with ".apps.googleusercontent.com"')
  }
  return config
}
