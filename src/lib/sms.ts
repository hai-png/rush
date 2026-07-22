
import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface SmsProvider {
  send(to: string, body: string): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

class TwilioSmsProvider implements SmsProvider {
  private env = loadEnv();
  private client: any = null;

  private initialized = false;

  private async ensureClient(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (this.env.TWILIO_ACCOUNT_SID && this.env.TWILIO_AUTH_TOKEN) {
      try {
        const { default: twilio } = await import('twilio');
        this.client = twilio(this.env.TWILIO_ACCOUNT_SID, this.env.TWILIO_AUTH_TOKEN);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'Failed to load twilio');
      }
    }
  }

  async send(to: string, body: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    await this.ensureClient();
    if (!this.client) {
      return { ok: false, error: 'Twilio client not initialized' };
    }
    if (!this.env.TWILIO_FROM) {
      return { ok: false, error: 'TWILIO_FROM not set' };
    }
    try {
      const msg = await this.client.messages.create({
        body,
        from: this.env.TWILIO_FROM,
        to,
      });
      logger.info({ to, messageId: msg.sid }, 'SMS sent via Twilio');
      return { ok: true, messageId: msg.sid };
    } catch (e) {
      logger.error({ err: (e as Error).message, to }, 'Twilio SMS failed');
      return { ok: false, error: (e as Error).message };
    }
  }
}

class ConsoleSmsProvider implements SmsProvider {
  async send(to: string, body: string): Promise<{ ok: boolean; messageId?: string }> {
    logger.info({ to, body: body.slice(0, 80) }, '[SMS:console]');
    console.log(`[SMS] -> ${to}: ${body}`);
    return { ok: true, messageId: `console-${Date.now()}` };
  }
}

let cachedProvider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cachedProvider) return cachedProvider;
  const env = loadEnv();
  cachedProvider = (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
    ? new TwilioSmsProvider()
    : new ConsoleSmsProvider();
  return cachedProvider;
}
