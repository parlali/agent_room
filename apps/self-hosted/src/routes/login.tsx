import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { BrandMark } from '#/components/agent-room'
import { roomQueryKey } from '#/lib/room-query-keys'
import { authSurfaceServer, currentUserServer, loginServer, signupServer } from './-auth-server'

export const Route = createFileRoute('/login')({
    beforeLoad: async () => {
        const user = await currentUserServer()
        if (user) throw redirect({ to: '/' })
    },
    component: LoginPage,
})

function LoginPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const surfaceQuery = useQuery({
        queryKey: roomQueryKey.authSurface,
        queryFn: () => authSurfaceServer(),
        retry: false,
    })
    const hostedSignupEnabled = surfaceQuery.data?.signupEnabled === true
    const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const login = useMutation({
        mutationFn: (payload: { email: string; password: string }) =>
            loginServer({ data: payload }),
        onSuccess: async () => {
            setError(null)
            setNotice(null)
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.authUser })
            await navigate({ to: '/' })
        },
        onError: () => setError('Invalid email or password.'),
    })

    const signup = useMutation({
        mutationFn: (payload: { email: string; password: string; name: string }) =>
            signupServer({ data: payload }),
        onSuccess: (result) => {
            setError(null)
            setNotice(
                `Check ${result.email} for the verification link. You will continue to billing after verifying.`,
            )
            setMode('sign-in')
            setPassword('')
        },
        onError: (signupError) => {
            setNotice(null)
            setError(
                signupError instanceof Error ? signupError.message : 'Could not create account.',
            )
        },
    })

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        const trimmedName = name.trim()
        if (!normalizedEmail || !password || (mode === 'sign-up' && !trimmedName)) {
            setError(
                mode === 'sign-up'
                    ? 'Name, email, and password are required.'
                    : 'Email and password are required.',
            )
            return
        }
        if (mode === 'sign-up' && password.length < 12) {
            setError('Password must be at least 12 characters.')
            return
        }
        setError(null)
        setNotice(null)
        if (mode === 'sign-up') {
            signup.mutate({ email: normalizedEmail, password, name: trimmedName })
            return
        }
        login.mutate({ email: normalizedEmail, password })
    }
    const pending = login.isPending || signup.isPending
    const title = mode === 'sign-up' ? 'Create your account' : 'Agent Room'
    const subtitle =
        mode === 'sign-up' ? 'Start with a paid hosted workspace.' : 'Sign in to your portal.'

    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--accent)_0%,_transparent_60%)] opacity-50" />

            <div className="w-full max-w-sm space-y-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-foreground/95 text-background">
                        <BrandMark size={24} className="text-background" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                    </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-card p-6 shadow-sm">
                    <form className="space-y-4" onSubmit={onSubmit} noValidate>
                        {error ? (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        ) : null}
                        {notice ? (
                            <Alert>
                                <AlertDescription>{notice}</AlertDescription>
                            </Alert>
                        ) : null}

                        {hostedSignupEnabled ? (
                            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
                                <Button
                                    type="button"
                                    variant={mode === 'sign-in' ? 'secondary' : 'ghost'}
                                    onClick={() => {
                                        setMode('sign-in')
                                        setError(null)
                                    }}
                                >
                                    Sign in
                                </Button>
                                <Button
                                    type="button"
                                    variant={mode === 'sign-up' ? 'secondary' : 'ghost'}
                                    onClick={() => {
                                        setMode('sign-up')
                                        setError(null)
                                    }}
                                >
                                    Create account
                                </Button>
                            </div>
                        ) : null}

                        {mode === 'sign-up' ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoComplete="name"
                                    required
                                />
                            </div>
                        ) : null}

                        <div className="space-y-1.5">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="username"
                                placeholder="root@agent-room.local"
                                autoFocus
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                required
                            />
                        </div>

                        <Button type="submit" size="lg" disabled={pending} className="w-full">
                            {pending
                                ? mode === 'sign-up'
                                    ? 'Creating account…'
                                    : 'Signing in…'
                                : mode === 'sign-up'
                                  ? 'Create account'
                                  : 'Sign in'}
                            <ArrowRightIcon />
                        </Button>
                    </form>
                </div>

                {!hostedSignupEnabled ? (
                    <p className="text-center text-xs text-muted-foreground">
                        First-run credentials live in your Docker bootstrap file. If you have lost
                        them, consult your deployment notes.
                    </p>
                ) : null}
            </div>
        </main>
    )
}
