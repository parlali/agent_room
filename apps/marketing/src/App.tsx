import { Anatomy } from './sections/Anatomy'
import { Capabilities } from './sections/Capabilities'
import { Closing } from './sections/Closing'
import { Demo } from './sections/Demo'
import { Deploy } from './sections/Deploy'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { Pricing } from './sections/Pricing'
import { Problem } from './sections/Problem'
import { AnchorScroll } from './components/AnchorScroll'
import { Nav } from './components/Nav'

export default function App() {
    return (
        <>
            <AnchorScroll />
            <Nav />
            <div
                id="top"
                className="site-shell relative min-h-screen bg-[var(--color-night)] pt-14 text-[var(--color-ink)]"
            >
                <div className="grain-overlay" />
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
        </>
    )
}
