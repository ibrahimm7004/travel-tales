import { createClient } from '@supabase/supabase-js'

// These will be set when Supabase integration is connected
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

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
  photo_types: string[]
  personalization_q1: string
  personalization_q2: string
  created_at: string
}