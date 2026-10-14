import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { OrientationLock } from './components/OrientationLock'
import { InstallPrompt } from './components/InstallPrompt'
import { Splash } from './components/Splash'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
    <OrientationLock enabled={false}>
      <App />
    </OrientationLock>
    <InstallPrompt />
  </StrictMode>,
)
