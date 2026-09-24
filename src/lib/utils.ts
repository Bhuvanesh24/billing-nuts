import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback
}
