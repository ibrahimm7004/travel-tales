# TravelTales Setup Guide

## Supabase Integration Setup

To enable the full TravelTales experience with authentication and data storage, you'll need to connect your Supabase project:

### 1. Configure Environment

- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your `.env` at the project root.

### 2. Set Up Database Schema

- Open your Supabase project dashboard
- Navigate to the SQL editor
- Run the SQL script from `supabase-schema.sql` to create the required tables and policies

### 3. Configure Authentication

- In Supabase dashboard, go to Authentication > Settings
- Enable email authentication
- Configure any additional auth providers if desired

## Features Implemented

### ✅ Auth Page (Welcome Screen)

- Centered "Welcome to TravelTales" text with vintage serif styling
- Main CTA: "Get Started" (anonymous onboarding flow)
- Secondary CTAs: Login/Signup with Supabase auth integration
- Warm cream/linen background with subtle vignette effect

### ✅ Film Strip Loader

- Custom CSS animation with vintage photo strip aesthetic
- Horizontal sliding animation with subtle flicker effects
- Sepia/ink tone color scheme matching the vintage theme

### ✅ Multi-step Onboarding Flow

- **Step 1**: Trip Info (Where, When, What)
- **Step 2**: Photo Details (Count, Types with multi-select)
- **Step 3**: Personalization Question 1 (Style preferences)
- **Step 4**: Personalization Question 2 (Priority preferences)
- Smooth slide/fade transitions using Framer Motion
- Progress indicator with dots styled as page markers
- Journal-style input fields with breathe animation on focus

### ✅ Coming Soon Page

- Animated photo scatter-to-stack effect
- Vintage aesthetic consistent with the rest of the app

### ✅ Design System

- **Colors**: Warm neutrals (cream, stone, beige) with muted accents (olive, terracotta, dusty blue)
- **Typography**: Crimson Text (serif) for headers, Inter (sans-serif) for body
- **Animations**: Custom CSS animations and Framer Motion transitions
- **Components**: Consistent vintage journal aesthetic throughout

### ✅ Database Integration

- **Profiles table**: Extends auth.users with additional profile data
- **User Answers table**: Stores onboarding responses (supports anonymous users)
- **RLS Policies**: Proper row-level security for data protection
- **Automatic Profile Creation**: Triggers create profiles on user signup

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS with custom design system
- **Animations**: Framer Motion + Custom CSS animations
- **Backend**: Supabase (PostgreSQL + Auth + Real-time)
- **UI Components**: shadcn/ui (customized for vintage aesthetic)

## Next Steps

Once Supabase is connected, the app will be fully functional with:

- User authentication (email/password)
- Anonymous onboarding support
- Persistent data storage
- Secure data access with RLS policies

The foundation is ready for future features like photo upload, AI processing, and story generation.
