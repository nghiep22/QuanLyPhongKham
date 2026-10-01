import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeIdempotent, hasPendingOperation, PendingOperationError, verifyPendingOperation } from './idempotent-operation'

function fakeSessionStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() { return entries.size },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(key) },
    setItem: (key, value) => { entries.set(key, value) },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('idempotent financial and stock submissions', () => {
  it('reuses the key after a lost response and starts a new intent only after success', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage())
    const keys: string[] = []
    let committed = false
    const operation = async (key: string) => {
      keys.push(key)
      if (!committed) { committed = true; throw new TypeError('response lost after commit') }
      return 'replayed'
    }
    const body = { amount: 50000, method: 'CASH' }
    await expect(executeIdempotent('user:pay:invoice', body, operation)).rejects.toThrow('response lost')
    await expect(executeIdempotent('user:pay:invoice', { ...body, amount: 60000 }, operation))
      .rejects.toBeInstanceOf(PendingOperationError)
    expect(await executeIdempotent('user:pay:invoice', body, operation)).toBe('replayed')
    await executeIdempotent('user:pay:invoice', body, operation)
    expect(keys).toHaveLength(3)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
  })

  it('keeps an uncertain transaction pending until the right context reloads successfully', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage())
    const scope = 'user:pay:invoice'
    await expect(executeIdempotent(scope, { amount: 50000 }, async () => {
      throw new TypeError('response lost')
    })).rejects.toThrow('response lost')

    let sameInvoice = false
    const reload = vi.fn(async () => {})
    expect(await verifyPendingOperation(scope, () => sameInvoice, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()

    sameInvoice = true
    expect(await verifyPendingOperation(scope, () => sameInvoice, async () => {
      sameInvoice = false
    })).toBe(false)
    expect(hasPendingOperation(scope)).toBe(true)

    sameInvoice = true
    await expect(verifyPendingOperation(scope, () => sameInvoice, async () => {
      throw new TypeError('reload failed')
    })).rejects.toThrow('reload failed')
    expect(hasPendingOperation(scope)).toBe(true)
    expect(await verifyPendingOperation(scope, () => sameInvoice, reload)).toBe(true)
    expect(hasPendingOperation(scope)).toBe(true)
  })
})
