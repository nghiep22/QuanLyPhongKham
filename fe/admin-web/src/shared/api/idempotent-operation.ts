import { ApiClientError } from '@clinic/generated-api-client'

type Uuid = ReturnType<typeof crypto.randomUUID>
type Pending = { fingerprint: string; key: Uuid }

const prefix = 'clinic:pending-operation:'

export class PendingOperationError extends Error {
  constructor() {
    super('Giao dịch trước chưa rõ kết quả. Hãy thử lại với đúng dữ liệu cũ, hoặc tải lại và đối chiếu trước khi bắt đầu giao dịch mới.')
  }
}

async function fingerprint(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function storageKey(scope: string) { return `${prefix}${scope}` }

export function clearPendingOperation(scope: string) {
  sessionStorage.removeItem(storageKey(scope))
}

export function hasPendingOperation(scope: string) {
  return sessionStorage.getItem(storageKey(scope)) !== null
}

export async function verifyPendingOperation(scope: string, contextMatches: () => boolean,
  reload: () => Promise<unknown>) {
  if (!hasPendingOperation(scope) || !contextMatches()) return false
  await reload()
  return hasPendingOperation(scope) && contextMatches()
}

export async function executeIdempotent<T>(scope: string, payload: unknown, operation: (key: Uuid) => Promise<T>) {
  const currentFingerprint = await fingerprint(payload)
  const stored = sessionStorage.getItem(storageKey(scope))
  const pending = stored ? JSON.parse(stored) as Pending : null
  if (pending && pending.fingerprint !== currentFingerprint) throw new PendingOperationError()
  const key = pending?.key ?? crypto.randomUUID()
  if (!pending) sessionStorage.setItem(storageKey(scope), JSON.stringify({ fingerprint: currentFingerprint, key }))
  try {
    const result = await operation(key)
    clearPendingOperation(scope)
    return result
  } catch (error) {
    // A validation or authorization response proves that this request was rejected before committing.
    if (error instanceof ApiClientError && error.status >= 400 && error.status < 500
      && ![408, 409, 429].includes(error.status)) clearPendingOperation(scope)
    throw error
  }
}
