import { describe, expect, it } from 'vitest'
import { assertSafeRoomPathId } from './room-paths'

describe('room paths', () => {
    it('rejects room ids that are not safe path segments', () => {
        expect(() => assertSafeRoomPathId('room-1_abc')).not.toThrow()
        expect(() => assertSafeRoomPathId('../system')).toThrow(/safe path segment/)
        expect(() => assertSafeRoomPathId('room/child')).toThrow(/safe path segment/)
        expect(() => assertSafeRoomPathId('')).toThrow(/safe path segment/)
    })
})
