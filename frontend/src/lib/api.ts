import axios from 'axios'

const resolvedBaseURL = (typeof window !== 'undefined')
  ? (import.meta.env.VITE_API_BASE_URL ?? `http://${window.location.hostname}:8000`)
  : 'http://127.0.0.1:8000'

const api = axios.create({
  baseURL: resolvedBaseURL,
})

api.interceptors.request.use((config) => {
  const token = (typeof window !== 'undefined') ? localStorage.getItem('token') : null
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api


