import { Resend } from 'resend';
import { loadEnv } from '@addis/shared';

/**
 * Email provider interface. Mirrors the SMS provider pattern: a thin interface
 * that the worker's email outbox handler calls, with a concrete implementation
 * backed by Resend (https://resend.com).
 */
export interface EmailProvider {
  send(input: EmailInput): Promise<boolean>;
}

export interface EmailInput {
  to: string;
  subject: string;
  body: string;
  /** Optional HTML body. If omitted, the text body is sent. */
  html?: string;
}

/**
 * Resend-backed email provider. Returns false (not throws) on failure so the
 * caller can decide whether to retry — the outbox handler wraps this in its
 * own try/catch and uses exponential backoff.
 */
export class ResendProvider implements EmailProvider {
  private env = loadEnv();
  private client: Resend | null = null;

  private getClient(): Resend {
    if (!this.client) {
      const apiKey = this.env.RESEND_API_KEY;
      if (!apiKey) throw new Error('RESEND_API_KEY not configured');
      this.client = new Resend(apiKey);
    }
    return this.client;
  }

  async send(input: EmailInput): Promise<boolean> {
    try {
      const client = this.getClient();
      // FIX (typecheck): under exactOptionalPropertyTypes, passing
      // `html: undefined` explicitly is rejected by Resend's types. Build
      // the payload conditionally so the `html` key is omitted entirely
      // when input.html is undefined.
      const payload: { from: string; to: string; subject: string; text: string; html?: string } = {
        from: 'Addis Ride <noreply@addisride.et>',
        to: input.to,
        subject: input.subject,
        text: input.body,
      };
      if (input.html) payload.html = input.html;
      const { error } = await client.emails.send(payload);
      return !error;
    } catch {
      return false;
    }
  }
}
