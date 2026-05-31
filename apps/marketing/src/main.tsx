import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import App from './App'

declare global {
    interface Window {
        __agentRoomMarketingRoot?: Root
    }
}

const root = document.getElementById('root')

if (!root) {
    throw new Error('Missing root element')
}

const reactRoot = window.__agentRoomMarketingRoot ?? createRoot(root)
window.__agentRoomMarketingRoot = reactRoot

reactRoot.render(
    <StrictMode>
        <App />
    </StrictMode>,
)
