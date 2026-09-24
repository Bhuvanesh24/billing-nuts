import type { DriveConfig } from './drive-config'

// Minimal typings for the parts of gapi / Google Identity Services we use.
interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

interface TokenClient {
  callback: (resp: TokenResponse) => void
  requestAccessToken: (opts?: { prompt?: string }) => void
}

interface GapiClient {
  init: (opts: { apiKey: string; discoveryDocs: string[] }) => Promise<void>
  setToken: (token: { access_token: string } | null) => void
  getToken: () => { access_token: string } | null
  drive: {
    files: {
      list: (params: Record<string, unknown>) => Promise<{ result: { files?: DriveFile[]; nextPageToken?: string } }>
      get: (params: Record<string, unknown>) => Promise<{ result: DriveFile }>
    }
  }
}

interface GapiGlobal {
  load: (name: string, cb: () => void) => void
  client: GapiClient
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (opts: { client_id: string; scope: string; callback: (resp: TokenResponse) => void }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

declare global {
  interface Window {
    gapi?: GapiGlobal
    google?: GoogleGlobal
  }
}

export interface DriveFile {
  id: string
  name: string
  webViewLink?: string
  mimeType?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
}

export interface ListPDFsResult {
  files: DriveFile[]
  nextPageToken?: string
}

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly'
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
const TOKEN_KEY = 'gdrive_token'

interface StoredToken {
  access_token: string
  expires_at: number
}

// One promise per script, so a second caller (e.g. React StrictMode re-running
// the init effect) waits for the same download instead of resolving early.
const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src)
  if (existing) return existing
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromises.delete(src) // allow a retry
      script.remove()
      reject(new Error(`Could not load ${src}. Check your internet connection or disable ad/tracker blockers for localhost.`))
    }
    document.head.appendChild(script)
  })
  scriptPromises.set(src, promise)
  return promise
}

export class GoogleDriveService {
  private clientId: string
  private apiKey: string
  private folderId: string
  private tokenClient: TokenClient | null = null
  private accessToken: string | null = null
  private hasConsented = false

  constructor({ clientId, apiKey, folderId }: DriveConfig) {
    this.clientId = clientId
    this.apiKey = apiKey
    this.folderId = folderId
  }

  async init(): Promise<void> {
    await Promise.all([
      loadScript('https://apis.google.com/js/api.js'),
      loadScript('https://accounts.google.com/gsi/client'),
    ])

    const gapi = window.gapi
    const google = window.google
    if (!gapi || !google) throw new Error('Google APIs failed to load')

    await new Promise<void>((resolve) => gapi.load('client', resolve))
    await gapi.client.init({ apiKey: this.apiKey, discoveryDocs: [DISCOVERY_DOC] })

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      callback: () => {},
    })

    this.restoreToken()
  }

  private restoreToken(): void {
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as StoredToken
      if (stored.access_token && stored.expires_at > Date.now()) {
        this.accessToken = stored.access_token
        this.hasConsented = true
        window.gapi?.client.setToken({ access_token: stored.access_token })
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  private saveToken(accessToken: string, expiresIn: number): void {
    // Expire a minute early so we never use a token that dies mid-upload.
    const stored: StoredToken = { access_token: accessToken, expires_at: Date.now() + (expiresIn - 60) * 1000 }
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(stored))
    } catch {
      // storage unavailable — token still works for this session
    }
  }

  isSignedIn(): boolean {
    if (!this.accessToken) return false
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as StoredToken
        if (stored.expires_at <= Date.now()) {
          this.accessToken = null
          return false
        }
      }
    } catch {
      // ignore
    }
    return true
  }

  signIn(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) {
        reject(new Error('Google Drive is not initialised yet'))
        return
      }
      this.tokenClient.callback = (resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google sign-in failed'))
          return
        }
        this.accessToken = resp.access_token
        this.hasConsented = true
        window.gapi?.client.setToken({ access_token: resp.access_token })
        this.saveToken(resp.access_token, Number(resp.expires_in ?? 3600))
        resolve()
      }
      this.tokenClient.requestAccessToken({ prompt: this.hasConsented ? '' : 'consent' })
    })
  }

  signOut(): void {
    const token = this.accessToken
    if (token) window.google?.accounts.oauth2.revoke(token)
    window.gapi?.client.setToken(null)
    this.accessToken = null
    localStorage.removeItem(TOKEN_KEY)
  }

  private requireToken(): string {
    if (!this.accessToken || !this.isSignedIn()) {
      throw new Error('Google Drive is not connected. Please connect Google Drive and try again.')
    }
    return this.accessToken
  }

  private async checkResponse(res: Response, action: string): Promise<void> {
    if (res.ok) return
    if (res.status === 401) {
      this.accessToken = null
      localStorage.removeItem(TOKEN_KEY)
      throw new Error('Google Drive session expired. Please reconnect Google Drive.')
    }
    const text = await res.text().catch(() => '')
    throw new Error(`Drive ${action} failed (${res.status}) ${text}`.trim())
  }

  async uploadFile(file: Blob, customName: string): Promise<DriveFile> {
    const token = this.requireToken()
    const metadata = {
      name: customName,
      mimeType: file.type || 'application/pdf',
      parents: [this.folderId],
    }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    form.append('file', file)

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    )
    await this.checkResponse(res, 'upload')
    return (await res.json()) as DriveFile
  }

  async updateFile(fileId: string, file: Blob): Promise<DriveFile> {
    const token = this.requireToken()
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/pdf' },
        body: file,
      },
    )
    await this.checkResponse(res, 'update')
    return (await res.json()) as DriveFile
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = this.requireToken()
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await this.checkResponse(res, 'delete')
  }

  async listPDFs(pageSize = 20, pageToken?: string, searchQuery?: string): Promise<ListPDFsResult> {
    this.requireToken()
    let q = `'${this.folderId}' in parents and mimeType='application/pdf' and trashed=false`
    if (searchQuery) q += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`
    const gapi = window.gapi
    if (!gapi) throw new Error('Google APIs not loaded')
    const res = await gapi.client.drive.files.list({
      q,
      pageSize,
      pageToken,
      orderBy: 'createdTime desc',
      fields: 'nextPageToken, files(id, name, webViewLink, createdTime, modifiedTime, size)',
    })
    return { files: res.result.files ?? [], nextPageToken: res.result.nextPageToken }
  }

  async getFileMetadata(fileId: string): Promise<DriveFile> {
    this.requireToken()
    const gapi = window.gapi
    if (!gapi) throw new Error('Google APIs not loaded')
    const res = await gapi.client.drive.files.get({
      fileId,
      fields: 'id, name, webViewLink, mimeType, createdTime, modifiedTime, size',
    })
    return res.result
  }
}
