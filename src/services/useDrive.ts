import { useContext } from 'react'
import { DriveContext, type DriveContextValue } from './DriveContext'

export function useDrive(): DriveContextValue {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within a DriveProvider')
  return ctx
}
