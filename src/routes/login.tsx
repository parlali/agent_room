import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { BrandMark } from '#/components/agent-room'
import { currentUserServer, loginServer } from './-auth-server'

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
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)

    const login = useMutation({
        mutationFn: (payload: { email: string; password: string }) =>
            loginServer({ data: payload }),
        onSuccess: async () => {
            setError(null)
            await queryClient.invalidateQueries({ queryKey: ['auth-current-user'] })
            await navigate({ to: '/' })
        },
        onError: () => setError('Invalid email or password.'),
    })

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        if (!normalizedEmail || !password) {
            setError('Email and password are required.')
            return
        }
        login.mutate({ email: normalizedEmail, password })
    }

    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--accent)_0%,_transparent_60%)] opacity-50" />

            <div className="w-full max-w-sm space-y-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-foreground/95 text-background">
                        <BrandMark size={24} className="text-background" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Agent Room</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Sign in to your private portal.
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-card p-6 shadow-sm">
                    <form className="space-y-4" onSubmit={onSubmit} noValidate>
                        {error ? (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
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

                        <Button
                            type="submit"
                            size="lg"
                            disabled={login.isPending}
                            className="w-full"
                        >
                            {login.isPending ? 'Signing in…' : 'Sign in'}
                            <ArrowRightIcon />
                        </Button>
                    </form>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                    First-run credentials live in your Docker bootstrap file. If you have lost them,
                    consult your deployment notes.
                </p>
            </div>
        </main>
    )
}
