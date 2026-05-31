import { BrandMark, BrandWordmark, brandTokens } from '@agent-room/brand'

export default function App() {
    return (
        <main className="placeholder-shell">
            <section className="placeholder-panel" aria-labelledby="placeholder-title">
                <div className="placeholder-mark" style={{ color: brandTokens.colors.ink }}>
                    <BrandMark size={72} title="Agent Room" />
                </div>
                <BrandWordmark className="placeholder-wordmark" />
                <p id="placeholder-title" className="placeholder-copy">
                    Marketing site placeholder
                </p>
            </section>
        </main>
    )
}
