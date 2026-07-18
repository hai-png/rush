import type { PaymentMethod } from '@addis/shared';
import type { PaymentProvider } from './provider';
import { TelebirrProvider } from './telebirr';
import { CbeBirrProvider } from './cbe';

const providers: Record<PaymentMethod, PaymentProvider> = {
  telebirr: new TelebirrProvider(),
  cbe: new CbeBirrProvider(),
};
export function getPaymentProvider(method: PaymentMethod): PaymentProvider { return providers[method]; }
export * from './provider';
