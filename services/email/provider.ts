import { Resend } from 'resend';
import { loadEnv } from '@addis/shared';

export interface EmailProvider {
  send(input: EmailInput): Promise<boolean>;
}

export interface EmailInput {
  to: string;
  subject: string;
  body: string;

  html?: string;
}

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
