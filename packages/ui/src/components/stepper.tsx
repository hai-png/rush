import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center w-full mb-6" aria-label="Progress">
      {steps.map((label, i) => (
        <li key={label} className="flex-1 flex items-center">
          <div className="flex flex-col items-center gap-1 flex-1">
            <div className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium border-2',
              i < current ? 'bg-primary border-primary text-primary-foreground' :
              i === current ? 'border-primary text-primary' : 'border-border text-muted-foreground',
            )}>
              {i < current ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">{label}</span>
          </div>
          {i < steps.length - 1 && <div className={cn('h-0.5 flex-1', i < current ? 'bg-primary' : 'bg-border')} />}
        </li>
      ))}
    </ol>
  );
}
