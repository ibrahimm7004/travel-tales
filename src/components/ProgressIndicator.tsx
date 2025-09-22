interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  className?: string;
}

export function ProgressIndicator({ currentStep, totalSteps, className }: ProgressIndicatorProps) {
  return (
    <div className={`flex justify-center gap-2 ${className}`}>
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={`progress-dot ${i <= currentStep ? 'active' : 'inactive'}`}
        />
      ))}
    </div>
  );
}