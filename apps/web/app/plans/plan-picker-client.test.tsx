import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanPickerClient } from './plan-picker-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@addis/i18n', () => ({ useFormatMoney: () => (n: string) => `ETB ${n}` }));
// Stub useToast so the component can render without a ToastProvider; keep the
// real presentational primitives (Button/Card/CardContent/Badge) via importActual.
vi.mock('@addis/ui', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@addis/ui');
  return { ...actual, useToast: () => ({ push: vi.fn() }) };
});

const plans = [{ id: 'p1', name: 'Monthly Unlimited', description: 'x', durationDays: 30, ridesIncluded: -1, priceETB: '1200.00', isPopular: true }];
const routes = [{ id: 'r1', name: 'Bole ↔ Merkato', fare: '60.00' }];

describe('PlanPickerClient', () => {
  it('disables continue until both a plan and a route are selected', () => {
    render(<PlanPickerClient plans={plans} routes={routes} />);
    // Initially: nothing selected → disabled.
    expect(screen.getByText('Continue to payment').closest('button')).toBeDisabled();
    // Select a plan only → still disabled (route missing).
    fireEvent.click(screen.getByText('Monthly Unlimited'));
    expect(screen.getByText('Continue to payment').closest('button')).toBeDisabled();
    // Select a route → enabled.
    fireEvent.click(screen.getByText('Bole ↔ Merkato'));
    expect(screen.getByText('Continue to payment').closest('button')).not.toBeDisabled();
  });

  it('shows Popular badge for flagged plans', () => {
    render(<PlanPickerClient plans={plans} routes={routes} />);
    expect(screen.getByText('Popular')).toBeInTheDocument();
  });
});
