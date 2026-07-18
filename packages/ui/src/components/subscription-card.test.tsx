import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubscriptionCard } from './subscription-card';

const baseSub = { id: 's1', status: 'active', planName: 'Monthly Unlimited', routeName: 'Bole ↔ Merkato', ridesUsed: 5, ridesIncluded: -1, endDate: '2025-06-01' };

describe('SubscriptionCard', () => {
  it('renders unlimited rides as ∞', () => {
    render(<SubscriptionCard sub={baseSub} />);
    expect(screen.getByText(/5 \/ ∞ rides used/)).toBeInTheDocument();
  });

  it('shows release + cancel actions only when active', () => {
    const onRelease = vi.fn(); const onCancel = vi.fn();
    render(<SubscriptionCard sub={baseSub} onRelease={onRelease} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Release a seat'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onRelease).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows renew action instead when expired', () => {
    const onRenew = vi.fn();
    render(<SubscriptionCard sub={{ ...baseSub, status: 'expired' }} onRenew={onRenew} />);
    expect(screen.queryByText('Release a seat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Renew'));
    expect(onRenew).toHaveBeenCalledOnce();
  });

  it('renders finite ride counts correctly', () => {
    render(<SubscriptionCard sub={{ ...baseSub, ridesUsed: 3, ridesIncluded: 10 }} />);
    expect(screen.getByText(/3 \/ 10 rides used/)).toBeInTheDocument();
  });
});
