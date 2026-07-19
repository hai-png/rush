import { ResendProvider, type EmailProvider, type EmailInput } from './provider';

export { ResendProvider };
export type { EmailProvider, EmailInput };

/** Singleton email provider instance. */
export const emailProvider: EmailProvider = new ResendProvider();
