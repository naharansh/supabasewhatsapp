import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
});

export async function sendOtpEmail(
  to: string,
  otp: string,
  userName?: string,
): Promise<void> {
  const siteName = process.env.SITE_NAME || "WA CRM";
  await transporter.sendMail({
    from: `"${siteName}" <${process.env.EMAIL_FROM}>`,
    to,
    subject: `Your ${siteName} verification code`,
    text: [
      `Hello${userName ? ` ${userName}` : ""},`,
      "",
      `Your verification code is: ${otp}`,
      "",
      `This code expires in 10 minutes.`,
      `If you did not request this code, please ignore this email.`,
      "",
      `— ${siteName}`,
    ].join("\n"),
    html: [
      `<p>Hello${userName ? ` <strong>${userName}</strong>` : ""},</p>`,
      `<p>Your verification code is:</p>`,
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; padding: 12px 20px; background: #f1f5f9; border-radius: 8px; text-align: center;">${otp}</p>`,
      `<p>This code expires in <strong>10 minutes</strong>.</p>`,
      `<p style="color: #666; font-size: 13px;">If you did not request this code, please ignore this email.</p>`,
      `<p style="color: #999; font-size: 12px;">— ${siteName}</p>`,
    ].join(""),
  });
}