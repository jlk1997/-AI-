/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sends the sign-in link. Deliberately dependency-free: an HTTP mail API is one
 * `fetch` away, while an SMTP client would drag a transport, TLS config and a
 * connection pool into a service that sends one kind of message. Self-hosters
 * with no mail service keep the previous behaviour (link echoed / logged).
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string | undefined;
  readonly pass: string | undefined;
}

export interface MailerConfig {
  /** `resend` and `http` post JSON; `smtp` speaks SMTP (QQ, 163, etc.). */
  readonly provider: 'none' | 'resend' | 'http' | 'smtp';
  readonly endpoint: string | undefined;
  readonly apiKey: string | undefined;
  readonly from: string | undefined;
  readonly smtp?: SmtpConfig;
}

/** Injected in tests so a unit test never opens a real socket. */
export type SmtpSender = (input: {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}) => Promise<void>;

export type MailResult =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly reason: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isMailerConfigured(config: MailerConfig): boolean {
  if (config.provider === 'none') return false;
  if (!config.from) return false;
  if (config.provider === 'resend') return Boolean(config.apiKey);
  if (config.provider === 'smtp') {
    return Boolean(config.smtp?.host && config.smtp.user && config.smtp.pass);
  }
  return Boolean(config.endpoint);
}

/**
 * Never throws: a mail outage must not turn a sign-in request into a 500. The
 * caller decides what to tell the visitor when delivery fails.
 */
export async function sendMail(
  config: MailerConfig,
  message: MailMessage,
  fetchImpl: typeof fetch = fetch,
  smtpSend?: SmtpSender,
): Promise<MailResult> {
  if (!isMailerConfigured(config)) {
    return { delivered: false, reason: 'mailer not configured' };
  }
  if (config.provider === 'smtp') {
    return sendSmtp(config, message, smtpSend);
  }
  const endpoint =
    config.provider === 'resend' ? RESEND_ENDPOINT : (config.endpoint as string);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) {
      return { delivered: false, reason: `mail provider returned ${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    return {
      delivered: false,
      reason: err instanceof Error ? err.message : 'mail request failed',
    };
  }
}

async function sendSmtp(
  config: MailerConfig,
  message: MailMessage,
  smtpSend: SmtpSender | undefined,
): Promise<MailResult> {
  try {
    const send = smtpSend ?? defaultSmtpSender(config);
    await send({
      from: config.from as string,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    return { delivered: true };
  } catch (err) {
    return {
      delivered: false,
      reason: err instanceof Error ? err.message : 'smtp send failed',
    };
  }
}

/**
 * Port 465 is implicit TLS. Port 587 with TLS on means STARTTLS: the socket
 * starts plain and upgrades. Treating 587 as `secure: true` makes QQ reject
 * the connection.
 */
export function smtpSocketMode(
  port: number,
  tls: boolean,
): { readonly secure: boolean; readonly requireTLS: boolean } {
  if (port === 465) return { secure: true, requireTLS: false };
  return { secure: false, requireTLS: tls };
}

function defaultSmtpSender(config: MailerConfig): SmtpSender {
  return async (input) => {
    const smtp = config.smtp;
    if (!smtp) throw new Error('smtp is not configured');
    const mode = smtpSocketMode(smtp.port, smtp.secure);
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: mode.secure,
      requireTLS: mode.requireTLS,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    });
  };
}

/** Six-digit sign-in code. Plain text for clients that skip HTML. */
export function emailCodeEmail(code: string, minutes: number): MailMessage {
  const text = [
    `你的隔壁登录验证码是 ${code}`,
    '',
    `${minutes} 分钟内有效，用过一次就失效。`,
    '如果不是你本人操作，忽略这封邮件即可。',
  ].join('\n');
  return {
    to: '',
    subject: '你的隔壁登录验证码',
    text,
    html: signInCardHtml({
      kicker: '登录验证码',
      title: '进你的小镇',
      body: `${minutes} 分钟内有效，用过一次就失效。`,
      code,
    }),
  };
}

/** Plain text plus the same card, for the older link door. */
export function magicLinkEmail(link: string, minutes: number): MailMessage {
  const text = [
    '隔壁登录链接：',
    '',
    link,
    '',
    `${minutes} 分钟内有效，只能用一次。`,
    '如果不是你本人操作，忽略这封邮件即可。',
  ].join('\n');
  const safeLink = escapeHtml(link);
  return {
    to: '',
    subject: '你的隔壁登录链接',
    text,
    html: signInCardHtml({
      kicker: '登录链接',
      title: '点一下就能进去',
      body: `${minutes} 分钟内有效，只能用一次。`,
      actionHref: safeLink,
      actionLabel: '登录隔壁',
    }),
  };
}

function signInCardHtml(input: {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly code?: string;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}): string {
  const codeBlock = input.code
    ? `<tr><td align="center" style="padding:8px 32px 8px;">
        <div style="font-family:Georgia,'Songti SC',serif;font-size:36px;letter-spacing:10px;color:#1c1917;background:#f4eee4;border-radius:16px;padding:18px 12px;">${escapeHtml(input.code)}</div>
      </td></tr>`
    : '';
  const action = input.actionHref
    ? `<tr><td align="center" style="padding:8px 32px 4px;">
        <a href="${input.actionHref}" style="display:inline-block;background:#c45c26;color:#fffaf3;text-decoration:none;border-radius:999px;padding:12px 28px;font-size:15px;">${escapeHtml(input.actionLabel ?? '打开')}</a>
      </td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#f4eee4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4eee4;">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fffaf3;border-radius:22px;overflow:hidden;">
        <tr><td style="background:#14121a;padding:22px 32px;">
          <div style="font-size:13px;letter-spacing:0.18em;color:#e0b25a;">GEBI</div>
          <div style="font-size:20px;color:#fffaf3;margin-top:4px;">隔壁 · AI 小镇</div>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:13px;color:#c45c26;font-weight:700;">${escapeHtml(input.kicker)}</div>
          <div style="font-size:26px;line-height:1.3;color:#1c1917;margin-top:6px;">${escapeHtml(input.title)}</div>
        </td></tr>
        ${codeBlock}
        ${action}
        <tr><td style="padding:12px 32px 8px;font-size:14px;line-height:1.7;color:#5c5348;">${escapeHtml(input.body)}</td></tr>
        <tr><td style="padding:8px 32px 28px;font-size:12px;line-height:1.6;color:#8a7d6e;">如果不是你本人操作，忽略这封邮件即可。验证码不会发给别人。</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
