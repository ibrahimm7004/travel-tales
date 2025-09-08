import { useCallback, useState } from 'react'

function Upload() {
  const [files, setFiles] = useState<File[]>([])

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const newFiles = Array.from(event.dataTransfer.files)
    setFiles(newFiles)
  }, [])

  const onChoose = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = event.target.files ? Array.from(event.target.files) : []
    setFiles(inputFiles)
  }, [])

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="border-2 border-dashed border-gray-300 rounded-md p-8 text-center text-gray-600"
      >
        Drag & drop files here
      </div>
      <div className="mt-3">
        <input type="file" multiple onChange={onChoose} />
      </div>
      {files.length > 0 && (
        <ul className="mt-4 list-disc list-inside text-sm text-gray-700">
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Upload


