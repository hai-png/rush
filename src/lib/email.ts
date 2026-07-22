
import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

class ResendEmailProvider implements EmailProvider {
  private env = loadEnv();
  private client: any = null;

  private initialized = false;

  private async ensureClient(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (this.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        this.client = new Resend(this.env.RESEND_API_KEY);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'Failed to load resend');
      }
    }
  }

  async send(to: string, subject: string, html: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    await this.ensureClient();
    if (!this.client) {
      return { ok: false, error: 'Resend client not initialized' };
    }
    try {
      const result = await this.client.emails.send({
        from: this.env.RESEND_FROM || 'Addis Ride <noreply@addisride.et>',
        to,
        subject,
        html,
      });
      logger.info({ to, subject, messageId: result.id }, 'Email sent via Resend');
      return { ok: true, messageId: result.id };
    } catch (e) {
      logger.error({ err: (e as Error).message, to, subject }, 'Resend email failed');
      return { ok: false, error: (e as Error).message };
    }
  }
}

class ConsoleEmailProvider implements EmailProvider {
  async send(to: string, subject: string, html: string): Promise<{ ok: boolean; messageId?: string }> {
    logger.info({ to, subject }, '[EMAIL:console]');
    console.log(`[EMAIL] -> ${to}: ${subject}`);
    return { ok: true, messageId: `console-${Date.now()}` };
  }
}

let cachedProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider;
  const env = loadEnv();
  cachedProvider = env.RESEND_API_KEY
    ? new ResendEmailProvider()
    : new ConsoleEmailProvider();
  return cachedProvider;
}
