import * as React from 'react';
import { Input, Label, FieldError } from '../primitives/input';

export const MoneyInput = React.forwardRef<HTMLInputElement, {
  label?: string; error?: string; value: string; onChange: (v: string) => void;
}>(({ label, error, value, onChange }, ref) => (
  <div>
    {label && <Label>{label}</Label>}
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">ETB</span>
      <Input
        ref={ref} inputMode="decimal" className="pl-12" aria-invalid={!!error}
        value={value}
        onChange={(e) => { if (/^\d*\.?\d{0,2}$/.test(e.target.value)) onChange(e.target.value); }}
      />
    </div>
    <FieldError>{error}</FieldError>
  </div>
));
MoneyInput.displayName = 'MoneyInput';
