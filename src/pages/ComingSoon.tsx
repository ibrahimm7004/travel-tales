import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function ComingSoon() {
  const [photos, setPhotos] = useState<Array<{ id: number; x: number; y: number; rotation: number }>>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Create scattered photos that will animate into a stack
    const photoArray = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: Math.random() * 400 - 200,
      y: Math.random() * 400 - 200,
      rotation: Math.random() * 60 - 30
    }));
    setPhotos(photoArray);

    // Animate photos into stack after a delay
    const timer = setTimeout(() => {
      setPhotos(prev => prev.map((photo, index) => ({
        ...photo,
        x: index * 2,
        y: index * -2,
        rotation: Math.random() * 10 - 5
      })));
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen vintage-bg flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12 animate-fade-slide-up">
        <h1 className="text-4xl md:text-5xl font-serif font-semibold text-foreground mb-4">
          Coming Soon!
        </h1>
        <p className="text-lg text-muted-foreground font-serif mb-2">
          Your travel story is being crafted
        </p>
        <p className="text-muted-foreground">
          We're working on something magical for your memories
        </p>
      </div>

      {/* Animated photo stack */}
      <div className="relative w-60 h-60 mb-12">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="absolute w-16 h-12 bg-card border border-border rounded shadow-vintage transition-all duration-2000 ease-out"
            style={{
              transform: `translate(${photo.x}px, ${photo.y}px) rotate(${photo.rotation}deg)`,
              left: '50%',
              top: '50%',
              marginLeft: '-32px',
              marginTop: '-24px'
            }}
          >
            <div className="w-full h-full bg-sepia-light rounded flex items-center justify-center">
              <div className="w-8 h-6 bg-sepia-medium rounded opacity-60"></div>
            </div>
          </div>
        ))}
        
        {/* Central stack base */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-20 h-14 bg-primary rounded shadow-vintage opacity-80"></div>
      </div>

      <Button
        onClick={() => navigate("/")}
        className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 shadow-vintage transition-all duration-200 active:scale-95"
      >
        Start Over
      </Button>
    </div>
  );
}