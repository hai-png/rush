import { defineStateMachine } from '@addis/shared';
import type { TripStatus, RideStatus } from '@addis/shared';

export const tripState = defineStateMachine<TripStatus>({
  initial: 'scheduled',
  transitions: [
    { from: 'scheduled', to: 'in_transit', event: 'contractor.start' },
    { from: 'in_transit', to: 'completed', event: 'contractor.complete', sideEffects: ['rides.fan_out', 'audit.trip_completed'] },
    { from: 'scheduled', to: 'cancelled', event: 'contractor.cancel' },
    { from: 'in_transit', to: 'cancelled', event: 'admin.cancel' },
  ],
});

export const rideState = defineStateMachine<RideStatus>({
  initial: 'booked',
  transitions: [
    { from: 'booked', to: 'boarded', event: 'rider.board' },
    { from: 'boarded', to: 'completed', event: 'trip.completed', sideEffects: ['subscription.increment_rides', 'seat_claim.mark_used'] },
    { from: 'booked', to: 'no_show', event: 'trip.completed' },
    { from: 'booked', to: 'cancelled', event: 'rider.cancel' },
  ],
});
