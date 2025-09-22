import { createClient } from '@supabase/supabase-js'

// These will be set via Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database schema types
export interface Profile {
  id: string
  full_name: string | null
  created_at: string
}

export interface UserAnswer {
  id: string
  user_id: string | null
  trip_where: string
  trip_when: string
  trip_what: string | null
  photo_count: number
  photo_types: string[]
  personalization_q1: string
  personalization_q2: string
  created_at: string
}