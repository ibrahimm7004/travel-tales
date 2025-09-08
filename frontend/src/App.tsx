import { Link, Outlet, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Upload from './pages/Upload'

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <nav className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-semibold">TravelTales</Link>
          <div className="space-x-3 text-sm">
            <Link to="/app/upload" className="text-blue-600">Upload</Link>
            <Link to="/login" className="text-gray-600">Login</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-4">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<div className="p-4">Welcome to your dashboard</div>} />
        <Route path="upload" element={<Upload />} />
        <Route path="albums/:id" element={<div className="p-4">Album detail coming soon</div>} />
      </Route>
    </Routes>
  )
}
