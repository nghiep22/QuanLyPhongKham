import { describe, expect, it } from 'vitest'
import { scopedSelection } from './scoped-selection'

const options = [{ publicId: 'new-service' }, { publicId: 'other-service' }]

describe('scopedSelection', () => {
  it('keeps a selection that belongs to the current scope', () => {
    expect(scopedSelection('other-service', options)).toBe('other-service')
  })

  it('replaces a stale selection after the branch changes', () => {
    expect(scopedSelection('old-branch-service', options)).toBe('new-service')
  })

  it('returns an empty selection when the current scope has no options', () => {
    expect(scopedSelection('old-branch-service', [])).toBe('')
  })
})
