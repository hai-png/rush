import { AfricasTalkingProvider } from './africas-talking';
import type { SmsProvider } from './provider';
export const smsProvider: SmsProvider = new AfricasTalkingProvider();
export * from './provider';
