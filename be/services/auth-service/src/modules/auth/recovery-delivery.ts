import { env } from '../../config.js';

export type RecoveryDeliveryMessage = {
  channel: 'EMAIL' | 'SMS';
  recipient: string;
  displayName: string;
  resetUrl: string;
  expiresAtUtc: string;
};

export interface RecoveryDelivery {
  deliver(message: RecoveryDeliveryMessage): Promise<void>;
}

class ConsoleRecoveryDelivery implements RecoveryDelivery {
  async deliver(message: RecoveryDeliveryMessage) {
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      developmentOnly: true,
      event: 'PASSWORD_RESET_DELIVERY',
      channel: message.channel,
      resetUrl: message.resetUrl,
      expiresAtUtc: message.expiresAtUtc,
    })}\n`);
  }
}

class WebhookRecoveryDelivery implements RecoveryDelivery {
  async deliver(message: RecoveryDeliveryMessage) {
    const response = await fetch(env.PASSWORD_RESET_WEBHOOK_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.PASSWORD_RESET_WEBHOOK_BEARER_TOKEN
          ? { authorization: `Bearer ${env.PASSWORD_RESET_WEBHOOK_BEARER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ type: 'PASSWORD_RESET', ...message }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Recovery delivery webhook failed with status ${response.status}.`);
  }
}

export function createRecoveryDelivery(): RecoveryDelivery {
  return env.PASSWORD_RESET_DELIVERY_MODE === 'webhook'
    ? new WebhookRecoveryDelivery()
    : new ConsoleRecoveryDelivery();
}
