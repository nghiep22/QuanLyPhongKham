import { env } from '../../config.js';

export type OtpDeliveryMessage = {
  channel: 'EMAIL' | 'SMS';
  recipient: string;
  displayName: string;
  otp: string;
  expiresAtUtc: string;
};

export interface OtpDelivery {
  deliver(message: OtpDeliveryMessage): Promise<void>;
}

class ConsoleOtpDelivery implements OtpDelivery {
  async deliver(message: OtpDeliveryMessage) {
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      developmentOnly: true,
      event: 'AUTH_OTP_DELIVERY',
      channel: message.channel,
      otp: message.otp,
      expiresAtUtc: message.expiresAtUtc,
    })}\n`);
  }
}

class WebhookOtpDelivery implements OtpDelivery {
  async deliver(message: OtpDeliveryMessage) {
    const response = await fetch(env.AUTH_OTP_WEBHOOK_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AUTH_OTP_WEBHOOK_BEARER_TOKEN
          ? { authorization: `Bearer ${env.AUTH_OTP_WEBHOOK_BEARER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ type: 'AUTH_OTP', ...message }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`OTP delivery webhook failed with status ${response.status}.`);
  }
}

export function createOtpDelivery(): OtpDelivery {
  return env.AUTH_OTP_DELIVERY_MODE === 'webhook' ? new WebhookOtpDelivery() : new ConsoleOtpDelivery();
}
