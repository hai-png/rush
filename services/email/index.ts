import { ResendProvider, type EmailProvider, type EmailInput } from './provider';

export { ResendProvider };
export type { EmailProvider, EmailInput };

export const emailProvider: EmailProvider = new ResendProvider();
