import { redirect } from '@tanstack/react-router'
import { currentUserServer } from './-auth-server'

export async function requireRouteUser() {
    const user = await currentUserServer()
    if (!user) {
        throw redirect({
            to: '/login',
        })
    }
    return user
}
