import { Anatomy } from './sections/Anatomy'
import { Capabilities } from './sections/Capabilities'
import { Closing } from './sections/Closing'
import { Demo } from './sections/Demo'
import { Deploy } from './sections/Deploy'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { Pricing } from './sections/Pricing'
import { Problem } from './sections/Problem'
import { Nav } from './components/Nav'
import { Ticker } from './components/Ticker'

export default function App() {
    return (
        <div
            id="top"
            className="relative isolate min-h-screen bg-[var(--color-night)] text-[var(--color-ink)]"
        >
            <div className="grain-overlay" />
            <Ticker />
            <Nav />
            <main className="relative z-10">
                <Hero />
                <Problem />
                <Anatomy />
                <section id="capabilities">
                    <Capabilities />
                </section>
                <Demo />
                <section id="deploy">
                    <Deploy />
                </section>
                <Pricing />
                <Closing />
            </main>
            <Footer />
        </div>
    )
}
