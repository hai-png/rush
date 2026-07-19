import { loadEnv } from '@addis/shared';
import type { SmsProvider } from './provider';
export class AfricasTalkingProvider implements SmsProvider {
  private env = loadEnv();
  async send(phone: string, message: string): Promise<boolean> {
    if (!this.env.AFRICAS_TALKING_API_KEY) return false;
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { apiKey: this.env.AFRICAS_TALKING_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ username: this.env.AFRICAS_TALKING_USERNAME!, to: phone, message }),
    });
    return res.ok;
  }
}
