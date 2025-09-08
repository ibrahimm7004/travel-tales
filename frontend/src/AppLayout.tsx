import { Link, Outlet } from 'react-router-dom'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background text-tt-charcoal">
      <nav className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-serif text-2xl text-tt-charcoal">TravelTales</Link>
          <div className="space-x-4 text-sm">
            <Link to="/app/upload" className="text-tt-accent">Upload</Link>
            <Link to="/login" className="text-tt-charcoal">Login</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout


