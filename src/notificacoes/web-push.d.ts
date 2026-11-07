// Tipos mínimos da biblioteca web-push (ela não traz os próprios).
declare module 'web-push' {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface RequestOptions {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
    timeout?: number;
  }
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(sub: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): Promise<{ statusCode: number }>;
  export class WebPushError extends Error {
    statusCode: number;
    body: string;
    endpoint: string;
  }
}
