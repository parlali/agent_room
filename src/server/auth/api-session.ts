import { parse } from 'cookie'
import { validateSessionToken } from './auth-service'
import { sessionCookieName } from './session-auth'

export async function requireApiSession(request: Request): Promise<boolean> {
    const cookies = parse(request.headers.get('cookie') ?? '')
    const token = cookies[sessionCookieName]?.trim()
    if (!token) {
        return false
    }

    return (await validateSessionToken(token)) !== null
}
