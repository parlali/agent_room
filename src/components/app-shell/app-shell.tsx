import { useState, type ReactNode } from 'react'
import { MenuIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet'
import { BrandWordmark } from '#/components/agent-room'
import { Sidebar } from './sidebar'

export function AppShell({ children }: { children: ReactNode }) {
    const [mobileOpen, setMobileOpen] = useState(false)

    return (
        <div className="flex min-h-screen w-full">
            <aside className="hidden w-[var(--sidebar-width,17rem)] shrink-0 border-r border-border md:block">
                <div className="sticky top-0 h-screen">
                    <Sidebar />
                </div>
            </aside>

            <div className="flex min-h-screen min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:hidden">
                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                                <MenuIcon />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-72 p-0">
                            <SheetHeader className="sr-only">
                                <SheetTitle>Navigation</SheetTitle>
                            </SheetHeader>
                            <Sidebar onNavigate={() => setMobileOpen(false)} />
                        </SheetContent>
                    </Sheet>
                    <BrandWordmark />
                    <span className="size-8" aria-hidden />
                </header>

                <main className="min-w-0 flex-1">{children}</main>
            </div>
        </div>
    )
}
