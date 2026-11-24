import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import '@fontsource/im-fell-english/latin-400.css'
import '@fontsource/literata/latin-400.css'
import '@fontsource/dm-mono/latin-400.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
