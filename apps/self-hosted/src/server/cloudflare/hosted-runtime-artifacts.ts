import type { AgentRoomHostedEnv } from './bindings'
import { decryptHostedSecret, encryptHostedSecret } from './hosted-secret-store'

const artifactFormat = 'agent-room-hosted-runtime-artifact-v1'

interface HostedRuntimeArtifactEnvelope {
    format: typeof artifactFormat
    cipherText: string
    nonce: string
    authTag: string
    keyVersion: number
    contentType: string
}

function parseEnvelope(value: string): HostedRuntimeArtifactEnvelope | null {
    try {
        const parsed = JSON.parse(value) as unknown
        if (!parsed || typeof parsed !== 'object') {
            return null
        }
        const record = parsed as Record<string, unknown>
        if (
            record.format !== artifactFormat ||
            typeof record.cipherText !== 'string' ||
            typeof record.nonce !== 'string' ||
            typeof record.authTag !== 'string' ||
            typeof record.keyVersion !== 'number' ||
            typeof record.contentType !== 'string'
        ) {
            return null
        }
        return record as unknown as HostedRuntimeArtifactEnvelope
    } catch {
        return null
    }
}

export async function putHostedRuntimeArtifact(input: {
    env: AgentRoomHostedEnv
    key: string
    plainText: string
    contentType: string
}): Promise<void> {
    const encrypted = await encryptHostedSecret({
        env: input.env,
        plainText: input.plainText,
    })
    const envelope: HostedRuntimeArtifactEnvelope = {
        format: artifactFormat,
        ...encrypted,
        contentType: input.contentType,
    }
    await input.env.AGENT_ROOM_WORKSPACE_BUCKET.put(input.key, JSON.stringify(envelope), {
        httpMetadata: {
            contentType: 'application/json',
        },
    })
}

export async function readHostedRuntimeArtifactText(input: {
    env: AgentRoomHostedEnv
    key: string
}): Promise<string> {
    const text = await readHostedRuntimeArtifactTextOrNull(input)
    if (text === null) {
        throw new Error('Hosted runtime artifact object was not found')
    }
    return text
}

export async function readHostedRuntimeArtifactTextOrNull(input: {
    env: AgentRoomHostedEnv
    key: string
}): Promise<string | null> {
    const object = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.get(input.key)
    if (!object) {
        return null
    }
    const text = await object.text()
    const envelope = parseEnvelope(text)
    if (!envelope) {
        throw new Error('Hosted runtime artifact is not encrypted')
    }
    return decryptHostedSecret({
        env: input.env,
        cipherText: envelope.cipherText,
        nonce: envelope.nonce,
        authTag: envelope.authTag,
    })
}
