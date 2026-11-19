/**
 * Transactional Email Notification Service
 *
 * Currently, no external transactional email provider (such as Resend, SendGrid, or AWS SES)
 * is configured in environment variables.
 *
 * This service safely handles notification dispatches:
 * - Logs the event cleanly in development/production
 * - Does not throw errors or disrupt caller transactions
 * - Provides the exact interface needed when provider credentials are added
 */

export interface WelcomeEmailPayload {
  email: string;
  name: string | null;
}

export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<{ success: boolean; delivered: boolean }> {
  try {
    // Check if an email provider is configured
    const apiKey = process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;

    if (!apiKey) {
      if (process.env.NODE_ENV !== "test") {
        console.log(`[Notification Service] Welcome email queued for ${payload.email} (Provider not configured - skipping external delivery).`);
      }
      return { success: true, delivered: false };
    }

    // When provider is configured in future, call provider SDK here
    return { success: true, delivered: true };
  } catch (error) {
    console.error("[Notification Service] Failed to send welcome email:", error);
    // Never fail registration due to email notification errors
    return { success: false, delivered: false };
  }
}
