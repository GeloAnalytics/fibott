import { Resend } from "resend";

const from = process.env.EMAIL_FROM ?? "Fibott <onboarding@resend.dev>";

function getResend(): Resend | null {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

async function send(to: string, subject: string, html: string) {
  const resend = getResend();
  if (!resend) {
    // No RESEND_API_KEY configured yet — log the link so the flow is still
    // testable locally instead of failing registration/reset outright.
    console.log(`[email] RESEND_API_KEY not set. Would send "${subject}" to ${to}:\n${html}`);
    return;
  }
  await resend.emails.send({ from, to, subject, html });
}

export async function sendVerificationEmail(email: string, token: string) {
  const link = `${baseUrl()}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  await send(
    email,
    "Verify your Fibott account",
    `<p>Welcome to Fibott! Click the link below to verify your email address.</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours.</p>`
  );
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const link = `${baseUrl()}/reset-password?token=${token}`;
  await send(
    email,
    "Reset your Fibott password",
    `<p>We received a request to reset your Fibott password.</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can safely ignore this email. This link expires in 1 hour.</p>`
  );
}
