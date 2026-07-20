import * as React from 'react';
import { Input, Label } from '../primitives/input';

/** Enforces Ethiopian +251 format visually while storing the canonical E.164 string.
 *
 *  FIX (UI-002): The previous implementation did not associate the <Label>
 *  with the <Input> via htmlFor/id — screen readers announced the input as
 *  "edit text, 9XXXXXXXX" with no label context. Clicking the label didn't
 *  focus the input. The error message was also not linked via
 *  aria-describedby, so screen readers didn't announce it.
 *  We now use React.useId() to generate a stable id, set htmlFor on the
 *  Label, id on the Input, and aria-describedby pointing to the error <p>.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, {
  label?: string; error?: string; value: string; onChange: (v: string) => void;
}>(({ label = 'Phone number', error, value, onChange }, ref) => {
  const reactId = React.useId();
  const inputId = `phone-input-${reactId}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const local = value.replace(/^\+251/, '');
  return (
    <div>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <div className="flex">
        <span className="flex items-center px-3 rounded-l-xl border border-r-0 border-border bg-secondary text-sm" id={`${inputId}-prefix`}>+251</span>
        <Input
          id={inputId}
          ref={ref} inputMode="numeric" maxLength={9} placeholder="9XXXXXXXX"
          className="rounded-l-none"
          aria-invalid={!!error}
          aria-describedby={errorId}
          value={local}
          onChange={(e) => onChange(`+251${e.target.value.replace(/\D/g, '')}`)}
        />
      </div>
      {error && <p id={errorId} role="alert" className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
});
PhoneInput.displayName = 'PhoneInput';
