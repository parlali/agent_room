import { useState, type ReactNode } from 'react'
import { MenuIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet'
import { BrandWordmark } from '#/components/agent-room'
import { Sidebar } from './sidebar'

export function AppShell({ children }: { children: ReactNode }) {
    const [mobileOpen, setMobileOpen] = useState(false)

    return (
        <div className="flex h-dvh w-full overflow-hidden">
            <aside className="hidden h-full w-[var(--sidebar-width,17rem)] shrink-0 overflow-hidden border-r border-border md:block">
                <Sidebar />
            </aside>

            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <header className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:hidden">
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

                <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
            </div>
        </div>
    )
}
