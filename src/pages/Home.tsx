import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilmStripLoader } from "@/components/FilmStripLoader";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { ChatboxWithSuggestions } from "@/components/ChatboxWithSuggestions";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [showAuthForms, setShowAuthForms] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleGetStarted = async () => {
    setIsLoading(true);
    // Simulate loading time for UX
    setTimeout(() => {
      setIsLoading(false);
      navigate("/onboarding");
    }, 2000);
  };

  const handleLogin = async () => {
    if (!email || !password) {
      toast({
        title: "Missing information",
        description: "Please enter your email and password.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: "Welcome back!",
        description: "Successfully logged in.",
      });

      navigate("/onboarding");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!email || !password || !fullName) {
      toast({
        title: "Missing information",
        description: "Please fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          }
        }
      });

      if (error) throw error;

      toast({
        title: "Account created!",
        description: "Please check your email to confirm your account.",
      });

      navigate("/onboarding");
    } catch (error: any) {
      toast({
        title: "Signup failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen vintage-bg flex items-center justify-center">
        <FilmStripLoader />
      </div>
    );
  }

  if (showAuthForms) {
    return (
      <div className="min-h-screen vintage-bg flex items-center justify-center p-4">
        <div className="max-w-md w-full animate-fade-slide-up">
          <div className="bg-card rounded-lg shadow-vintage p-8 border border-border">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-serif font-semibold text-[#456409] mb-2">
                {isLogin ? "Welcome Back" : "Join TravelTales"}
              </h2>
              <p className="text-[#456409]">
                {isLogin ? "Sign in to your account" : "Create your account to get started"}
              </p>
            </div>

            <div className="space-y-4">
              {!isLogin && (
                <div className="breathe">
                  <label className="block text-sm font-medium text-[#456409] mb-2">
                    Full Name
                  </label>
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="journal-input"
                  />
                </div>
              )}
              
              <div className="breathe">
                <label className="block text-sm font-medium text-[#456409] mb-2">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="journal-input"
                />
              </div>

              <div className="breathe">
                <label className="block text-sm font-medium text-[#456409] mb-2">
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="journal-input"
                />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <button
                onClick={isLogin ? handleLogin : handleSignup}
                className="w-full cta-button"
                disabled={isLoading}
              >
                {isLogin ? "Sign In" : "Create Account"}
              </button>

              <div className="text-center">
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-sm text-[#456409] hover:opacity-80 transition-colors"
                >
                  {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>

              <div className="text-center">
                <button
                  onClick={() => setShowAuthForms(false)}
                  className="text-sm text-[#456409] hover:opacity-80 transition-colors"
                >
                  ← Back to welcome
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen vintage-bg relative">
      {/* Top-right auth buttons */}
      <div className="absolute top-6 right-6 z-10">
        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              setIsLogin(true);
              setShowAuthForms(true);
            }}
            className="ghost-auth-button text-xl text-[#456409]" style={{ fontFamily: "'Supernova', sans-serif" }}
          >
            Login
          </button>
          <button
            onClick={() => {
              setIsLogin(false);
              setShowAuthForms(true);
            }}
            className="ghost-auth-button text-xl text-[#456409]" style={{ fontFamily: "'Supernova', sans-serif" }}
          >
            Sign Up
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-2xl w-full text-center animate-fade-slide-up mt-20 md:mt-32 lg:mt-40">
          <div className="mb-16 space-y-6">
            <h1 className="text-7xl md:text-8xl font-serif font-semibold text-white leading-tight text-shadow-soft" style={{ fontFamily: "'Supernova', sans-serif" }}>
              traveltales
            </h1>
            <p className="text-xl md:text-1xl text-white font-sans italic mt-8 leading-relaxed transform translate-y-1 md:translate-y-2">
              TURN YOUR TRAVEL MEMORIES INTO BEAUTIFUL STORIES
            </p>
          </div>

          <div className="space-y-8">
            <ChatboxWithSuggestions 
              onSend={() => navigate("/onboarding")} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}