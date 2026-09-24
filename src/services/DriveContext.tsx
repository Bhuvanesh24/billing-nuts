import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GoogleDriveService, type DriveFile, type ListPDFsResult } from './google-drive-service'
import { getDriveConfig } from './drive-config'

export interface DriveContextValue {
  driveService: GoogleDriveService | null
  isInitialized: boolean
  isSignedIn: boolean
  signIn: () => Promise<void>
  signOut: () => void
  uploadFile: (file: Blob, name: string) => Promise<DriveFile>
  updateFile: (fileId: string, file: Blob) => Promise<DriveFile>
  deleteFile: (fileId: string) => Promise<void>
  listPDFs: (pageSize?: number, pageToken?: string, searchQuery?: string) => Promise<ListPDFsResult>
  loading: boolean
  error: string | null
}

export const DriveContext = createContext<DriveContextValue | null>(null)

/** gapi rejects with plain objects like { error: { message } } or { details }, not Error instances. */
function googleErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const obj = e as { error?: { message?: string } | string; details?: string; result?: { error?: { message?: string } } }
    const msg =
      (typeof obj.error === 'object' && obj.error?.message) ||
      obj.result?.error?.message ||
      obj.details ||
      (typeof obj.error === 'string' && obj.error)
    if (msg) return `Google Drive: ${msg}`
  }
  return 'Failed to initialise Google Drive'
}

export function DriveProvider({ children }: { children: ReactNode }) {
  const [driveService, setDriveService] = useState<GoogleDriveService | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const service = new GoogleDriveService(getDriveConfig())
        await service.init()
        if (cancelled) return
        setDriveService(service)
        setIsInitialized(true)
        setIsSignedIn(service.isSignedIn())
      } catch (e) {
        if (!cancelled) setError(googleErrorMessage(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const requireService = useCallback((): GoogleDriveService => {
    if (!driveService) throw new Error('Google Drive is not initialised')
    return driveService
  }, [driveService])

  // Any Drive call that finds an expired token flips the UI back to "Offline".
  const track = useCallback(
    async <T,>(fn: (s: GoogleDriveService) => Promise<T>): Promise<T> => {
      const service = requireService()
      try {
        return await fn(service)
      } finally {
        setIsSignedIn(service.isSignedIn())
      }
    },
    [requireService],
  )

  const signIn = useCallback(async () => {
    const service = requireService()
    setError(null)
    await service.signIn()
    setIsSignedIn(true)
  }, [requireService])

  const signOut = useCallback(() => {
    driveService?.signOut()
    setIsSignedIn(false)
  }, [driveService])

  const value = useMemo<DriveContextValue>(
    () => ({
      driveService,
      isInitialized,
      isSignedIn,
      signIn,
      signOut,
      uploadFile: (file, name) => track((s) => s.uploadFile(file, name)),
      updateFile: (fileId, file) => track((s) => s.updateFile(fileId, file)),
      deleteFile: (fileId) => track((s) => s.deleteFile(fileId)),
      listPDFs: (pageSize, pageToken, searchQuery) => track((s) => s.listPDFs(pageSize, pageToken, searchQuery)),
      loading,
      error,
    }),
    [driveService, isInitialized, isSignedIn, signIn, signOut, track, loading, error],
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}
