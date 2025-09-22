import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilmStripLoader } from "@/components/FilmStripLoader";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
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
              <h2 className="text-2xl font-serif font-semibold text-foreground mb-2">
                {isLogin ? "Welcome Back" : "Join TravelTales"}
              </h2>
              <p className="text-muted-foreground">
                {isLogin ? "Sign in to your account" : "Create your account to get started"}
              </p>
            </div>

            <div className="space-y-4">
              {!isLogin && (
                <div className="breathe">
                  <label className="block text-sm font-medium text-foreground mb-2">
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
                <label className="block text-sm font-medium text-foreground mb-2">
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
                <label className="block text-sm font-medium text-foreground mb-2">
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
              <Button
                onClick={isLogin ? handleLogin : handleSignup}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 shadow-vintage transition-all duration-200 active:scale-95"
                disabled={isLoading}
              >
                {isLogin ? "Sign In" : "Create Account"}
              </Button>

              <div className="text-center">
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>

              <div className="text-center">
                <button
                  onClick={() => setShowAuthForms(false)}
                  className="text-sm text-primary hover:text-primary/80 transition-colors"
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
    <div className="min-h-screen vintage-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center animate-fade-slide-up">
        <div className="mb-12">
          <h1 className="text-5xl md:text-6xl font-serif font-semibold text-foreground mb-6 text-shadow-soft">
            Welcome to
          </h1>
          <h1 className="text-5xl md:text-6xl font-serif font-semibold text-primary mb-8 text-shadow-soft">
            TravelTales
          </h1>
          <p className="text-lg text-muted-foreground font-serif italic">
            Turn your travel memories into beautiful stories
          </p>
        </div>

        <div className="space-y-4">
          <Button 
            onClick={handleGetStarted}
            size="lg" 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 text-lg shadow-vintage transition-all duration-200 hover:shadow-soft active:scale-95"
          >
            Get Started
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-background text-muted-foreground font-serif">
                or
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => {
                setIsLogin(true);
                setShowAuthForms(true);
              }}
              variant="outline"
              size="lg"
              className="flex-1 bg-card hover:bg-warm-beige border-border text-foreground py-6 shadow-soft transition-all duration-200 hover:shadow-vintage active:scale-95"
            >
              Login
            </Button>
            <Button
              onClick={() => {
                setIsLogin(false);
                setShowAuthForms(true);
              }}
              variant="outline"
              size="lg"
              className="flex-1 bg-card hover:bg-warm-beige border-border text-foreground py-6 shadow-soft transition-all duration-200 hover:shadow-vintage active:scale-95"
            >
              Sign Up
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}