import { z } from 'zod';
import { MoneyString, TimeOfDay } from '@addis/shared';

export const LatLng = z.tuple([z.number(), z.number()]);
export const CreateRouteInput = z.object({
  name: z.string().min(3), origin: z.string(), destination: z.string(),
  stops: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number() })).default([]),
  polyline: z.array(LatLng).default([]),
  originLatLng: LatLng, destLatLng: LatLng,
  distanceKm: z.number().positive(), durationMin: z.number().int().positive(),
  morningWindow: z.object({ start: TimeOfDay, end: TimeOfDay }),
  eveningWindow: z.object({ start: TimeOfDay, end: TimeOfDay }),
  fare: MoneyString, needsShuttle: z.boolean().default(true),
});
export const UpdateRouteInput = CreateRouteInput.partial().extend({ isActive: z.boolean().optional() });

export const CreatePlanInput = z.object({
  name: z.string().min(3), durationDays: z.number().int().positive(),
  ridesIncluded: z.number().int(), priceETB: MoneyString, description: z.string(),
  isPopular: z.boolean().default(false), isTrial: z.boolean().default(false),
});
export const UpdatePlanInput = CreatePlanInput.partial().extend({ isActive: z.boolean().optional() });

export const CreateShuttleInput = z.object({
  plateNumber: z.string(), model: z.string(), year: z.number().int(),
  vehicleType: z.enum(['coaster', 'minibus', 'van', 'sedan']),
  capacity: z.number().int().positive().default(14),
  contractorId: z.string().optional(),
});
export const UpdateShuttleInput = CreateShuttleInput.partial().extend({ isActive: z.boolean().optional() });
