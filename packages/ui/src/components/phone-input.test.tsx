import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhoneInput } from './phone-input';

describe('PhoneInput', () => {
  it('always prefixes +251 and strips non-digits', () => {
    const onChange = vi.fn();
    render(<PhoneInput value="+251" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '9a2b2555999' } });
    expect(onChange).toHaveBeenCalledWith('+251922555999');
  });

  it('renders field error when provided', () => {
    render(<PhoneInput value="+251" onChange={() => {}} error="Invalid number" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid number');
  });
});
