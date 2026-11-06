import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!)

  if (clerkKey) {
    const { ClerkProvider } = await import('@clerk/clerk-react')
    root.render(
      <StrictMode>
        <ClerkProvider publishableKey={clerkKey}>
          <App />
        </ClerkProvider>
      </StrictMode>
    )
  } else {
    // No Clerk key → run without auth (hackathon demo mode)
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  }
}

bootstrap()
