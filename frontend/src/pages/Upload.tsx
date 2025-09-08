import { useCallback, useState } from 'react'
import api from '../lib/api'
import { ProtectedRoute } from '../contexts/AuthContext'

type Uploaded = { id: number; path: string }

function UploadInner() {
  const [files, setFiles] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<Uploaded[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onChoose = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = event.target.files ? Array.from(event.target.files) : []
    setFiles(inputFiles)
  }, [])

  const onUpload = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const r = await api.post<{ files: Uploaded[] }>('/photos/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUploaded(r.data.files)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Upload failed')
    } finally {
      setLoading(false)
    }
  }, [files])

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow space-y-4">
      <h1 className="text-2xl font-bold">Upload Photos</h1>
      <input type="file" multiple onChange={onChoose} />
      <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={onUpload} disabled={loading || files.length === 0}>
        {loading ? 'Uploading...' : 'Upload'}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {files.map((f) => (
            <div key={f.name} className="text-sm text-gray-700 border rounded p-2">{f.name}</div>
          ))}
        </div>
      )}

      {uploaded.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Uploaded</h2>
          <div className="grid grid-cols-2 gap-2">
            {uploaded.map((u) => (
              <div key={u.id} className="text-sm text-gray-700 border rounded p-2 break-all">{u.path}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )}

export default function Upload() {
  return (
    <ProtectedRoute>
      <UploadInner />
    </ProtectedRoute>
  )
}


