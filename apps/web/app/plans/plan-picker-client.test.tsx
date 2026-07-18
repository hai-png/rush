import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanPickerClient } from './plan-picker-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@addis/i18n', () => ({ useFormatMoney: () => (n: string) => `ETB ${n}` }));

const plans = [{ id: 'p1', name: 'Monthly Unlimited', description: 'x', durationDays: 30, ridesIncluded: -1, priceETB: '1200.00', isPopular: true }];
const routes = [{ id: 'r1', name: 'Bole ↔ Merkato', fare: '60.00' }];

describe('PlanPickerClient', () => {
  it('disables continue until a plan is selected', () => {
    render(<PlanPickerClient plans={plans} routes={routes} />);
    expect(screen.getByText('Continue to payment').closest('button')).toBeDisabled();
    fireEvent.click(screen.getByText('Monthly Unlimited'));
    expect(screen.getByText('Continue to payment').closest('button')).not.toBeDisabled();
  });

  it('shows Popular badge for flagged plans', () => {
    render(<PlanPickerClient plans={plans} routes={routes} />);
    expect(screen.getByText('Popular')).toBeInTheDocument();
  });
});
