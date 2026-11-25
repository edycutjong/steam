import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { browserEnv, registerOfflineShell } from './offline/register.ts'
import '@fontsource/im-fell-english/latin-400.css'
import '@fontsource/literata/latin-400.css'
import '@fontsource/literata/latin-400-italic.css'
import '@fontsource/literata/latin-500.css'
import '@fontsource/literata/latin-600.css'
import '@fontsource/dm-mono/latin-400.css'
import './index.css'
import './app/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// production builds only; a failure here never reaches the app
registerOfflineShell(browserEnv())
