"""Registration verification email delivery (JHEP-24).

`EmailSender` is the transport protocol; four adapters ship:

- `ConsoleSender`  — the default: writes the link to the log
  (deterministic for tests/CI; no mail server required).
- `MailpitSender`  — the local demo catcher (the email visible in
  Mailpit's web UI).
- `SmtpSender`     — the UNIVERSAL production transport: any SMTP
  provider (Gmail app-password, Mailgun, SES, SendGrid, Brevo, the
  company mail relay) configured entirely through environment
  variables.
- `ResendSender`   — Resend's HTTPS API (the JHEP-102-confirmed
  production candidate).

Fail-fast rule (per docs/configuration.md's "the backend fails fast on
missing config"): a transport selected in `EMAIL_DELIVERY` whose
credentials are missing raises at factory time — a misconfigured
production email is a launch-blocking error, not a silent log-only mode.
"""

import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    def send(self, *, to: str, subject: str, body: str) -> None: ...


class ConsoleSender:
    """Default transport: the link is logged with the recipient and
    subject, so unit tests and CI never require a mail server."""

    def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info("EMAIL to=%s subject=%s link=%s", to, subject, body)


class MailpitSender:
    """Local demo transport: delivers via Mailpit's SMTP catcher so the
    verification email — and its one-time link — is visible in Mailpit's
    browser UI (compose port 8025)."""

    def send(self, *, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        with smtplib.SMTP(
            settings.email_smtp_host, settings.email_smtp_port, timeout=10
        ) as smtp:
            smtp.send_message(message)


class SmtpSender:
    """Universal production transport: any SMTP provider, configured
    entirely through environment variables (host/port/user/password/
    STARTTLS). Gmail app-passwords, Mailgun, SES, SendGrid, Brevo, or the
    company's own mail relay — the adapter is identical."""

    def send(self, *, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        if settings.email_smtp_starttls:
            with smtplib.SMTP(
                settings.email_smtp_host, settings.email_smtp_port, timeout=15
            ) as smtp:
                smtp.ehlo()
                smtp.starttls()
                if settings.email_smtp_user:
                    smtp.login(settings.email_smtp_user, settings.email_smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP_SSL(
                settings.email_smtp_host, settings.email_smtp_port, timeout=15
            ) as smtp:
                if settings.email_smtp_user:
                    smtp.login(settings.email_smtp_user, settings.email_smtp_password)
                smtp.send_message(message)


class ResendSender:
    """Resend's HTTPS API transport (the JHEP-102-confirmed production
    candidate). Selected with EMAIL_DELIVERY=resend + EMAIL_API_KEY."""

    def send(self, *, to: str, subject: str, body: str) -> None:
        import json
        import urllib.request

        request = urllib.request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(
                {
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "text": body,
                }
            ).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {settings.email_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status >= 400:
                raise RuntimeError(f"Resend delivery failed: {response.status}")


def email_sender() -> EmailSender:
    """Select the transport by settings switch (`email_delivery`).

    Fail-fast: a selected transport whose credentials are missing raises
    (instead of silently falling back to console) — a misconfigured
    production email must block startup, per the repo's configuration
    philosophy.
    """
    delivery = settings.email_delivery

    if delivery == "console":
        return ConsoleSender()
    if delivery == "mailpit":
        return MailpitSender()
    if delivery == "smtp":
        if not settings.email_smtp_user or not settings.email_smtp_password:
            raise RuntimeError(
                "EMAIL_DELIVERY=smtp requires EMAIL_SMTP_USER and "
                "EMAIL_SMTP_PASSWORD in the environment"
            )
        return SmtpSender()
    if delivery == "resend":
        if not settings.email_api_key:
            raise RuntimeError(
                "EMAIL_DELIVERY=resend requires EMAIL_API_KEY in the environment"
            )
        return ResendSender()

    raise RuntimeError(f"Unknown EMAIL_DELIVERY value: {delivery!r}")
