import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, KeyRound } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { AgentRoomMark } from './-app-layout'
import { currentUserServer, loginServer } from './-auth-server'

export const Route = createFileRoute('/login')({
    beforeLoad: async () => {
        const user = await currentUserServer()
        if (user) {
            throw redirect({
                to: '/',
            })
        }
    },
    component: LoginPage,
})

function LoginPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [errorNotice, setErrorNotice] = useState<string | null>(null)

    const loginMutation = useMutation({
        mutationFn: async (payload: { email: string; password: string }) =>
            loginServer({
                data: payload,
            }),
        onSuccess: async () => {
            setErrorNotice(null)
            await queryClient.invalidateQueries({
                queryKey: ['auth-current-user'],
                exact: false,
            })
            await navigate({
                to: '/',
            })
        },
        onError: () => {
            setErrorNotice('Invalid email or password')
        },
    })

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        if (!normalizedEmail || !password) {
            setErrorNotice('Email and password are required')
            return
        }
        loginMutation.mutate({
            email: normalizedEmail,
            password,
        })
    }

    return (
        <main className="login-shell">
            <section className="login-card">
                <div className="login-brand">
                    <AgentRoomMark className="login-mark" />
                    <span>
                        <strong>Agent Room</strong>
                        <small>Self-hosted</small>
                    </span>
                </div>

                <div className="login-copy">
                    <h1>Sign in</h1>
                    <p>Use the root credentials created on first boot.</p>
                </div>

                {errorNotice ? <p className="form-alert danger">{errorNotice}</p> : null}

                <form className="login-form" onSubmit={onSubmit}>
                    <label>
                        Email
                        <input
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="username"
                            placeholder="root@agent-room.local"
                        />
                    </label>
                    <label>
                        Password
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                        />
                    </label>
                    <button
                        type="submit"
                        className="button primary"
                        disabled={loginMutation.isPending}
                    >
                        <KeyRound size={17} />
                        {loginMutation.isPending ? 'Signing in' : 'Sign in'}
                        <ArrowRight size={17} />
                    </button>
                </form>

                <p className="login-hint">
                    First-run credentials are stored in the Docker bootstrap file for recovery.
                </p>
            </section>
        </main>
    )
}
