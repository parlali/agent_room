import { describe, expect, it } from 'vitest'
import {
    resolveHostedRoomImageReady,
    resolveHostedRoomImageSecret,
    resolveHostedRoomSearchReady,
} from './hosted-room-service'

describe('hosted room search readiness', () => {
    it('marks Brave search ready when the hosted managed Brave key is available', () => {
        expect(
            resolveHostedRoomSearchReady({
                searchEnabled: true,
                braveEnabled: true,
                braveSecretId: null,
                managedBraveAvailable: true,
            }),
        ).toBe(true)
    })

    it('marks Brave search ready when a workspace Brave key is stored', () => {
        expect(
            resolveHostedRoomSearchReady({
                searchEnabled: true,
                braveEnabled: true,
                braveSecretId: 'secret_brave',
                managedBraveAvailable: false,
            }),
        ).toBe(true)
    })

    it('does not mark enabled Brave search ready without a managed or stored key', () => {
        expect(
            resolveHostedRoomSearchReady({
                searchEnabled: true,
                braveEnabled: true,
                braveSecretId: null,
                managedBraveAvailable: false,
            }),
        ).toBe(false)
    })
})

describe('hosted room image secret resolution', () => {
    it('clears stale room image secrets when the room image provider changes', () => {
        expect(
            resolveHostedRoomImageSecret({
                roomId: 'room_1',
                currentImageProvider: 'openai',
                currentImageSecretId: 'secret_openai',
                imageProvider: 'gemini',
                imageModel: 'imagen-3',
                imageApiKey: '',
            }),
        ).toEqual({
            imageProvider: 'gemini',
            imageModel: 'imagen-3',
            imageSecretId: null,
            upsert: null,
        })
    })

    it('uses provider-scoped secret keys when rotating room image credentials', () => {
        expect(
            resolveHostedRoomImageSecret({
                roomId: 'room_1',
                currentImageProvider: 'openai',
                currentImageSecretId: 'secret_openai',
                imageProvider: 'gemini',
                imageModel: 'imagen-3',
                imageApiKey: 'gemini-key',
            }),
        ).toEqual({
            imageProvider: 'gemini',
            imageModel: 'imagen-3',
            imageSecretId: null,
            upsert: {
                keyName: 'room:room_1:image:gemini',
                plainText: 'gemini-key',
            },
        })
    })

    it('does not mark a room image provider ready from an app image secret', () => {
        expect(
            resolveHostedRoomImageReady({
                roomImageProvider: 'gemini',
                roomImageSecretId: null,
                appImageProvider: 'openai',
                appImageSecretId: 'secret_openai',
            }),
        ).toBe(false)
    })

    it('marks app image provider readiness from the app image secret only', () => {
        expect(
            resolveHostedRoomImageReady({
                roomImageProvider: null,
                roomImageSecretId: null,
                appImageProvider: 'openai',
                appImageSecretId: 'secret_openai',
            }),
        ).toBe(true)
    })
})
