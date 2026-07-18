import * as React from 'react';
import { Input, Label, FieldError } from '../primitives/input';

/** Enforces Ethiopian +251 format visually while storing the canonical E.164 string. */
export const PhoneInput = React.forwardRef<HTMLInputElement, {
  label?: string; error?: string; value: string; onChange: (v: string) => void;
}>(({ label = 'Phone number', error, value, onChange }, ref) => {
  const local = value.replace(/^\+251/, '');
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div className="flex">
        <span className="flex items-center px-3 rounded-l-xl border border-r-0 border-border bg-secondary text-sm">+251</span>
        <Input
          ref={ref} inputMode="numeric" maxLength={9} placeholder="9XXXXXXXX"
          className="rounded-l-none" aria-invalid={!!error}
          value={local}
          onChange={(e) => onChange(`+251${e.target.value.replace(/\D/g, '')}`)}
        />
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
});
PhoneInput.displayName = 'PhoneInput';
