export default function Landing() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">TravelTales</h1>
        <p className="text-gray-600">Curate your best travel photos with AI (coming soon)</p>
        <div className="flex items-center justify-center gap-3">
          <a href="/signup" className="px-4 py-2 bg-blue-600 text-white rounded">Get Started</a>
          <a href="#" className="px-4 py-2 border rounded">See a Sample Album</a>
        </div>
      </div>
    </div>
  )
}


