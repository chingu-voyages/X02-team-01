"""Registration verification email delivery (JHEP-24).

`EmailSender` is the transport protocol; `ConsoleSender` ships as the
default (writes the verification link to the log — deterministic for
tests/CI), `MailpitSender` posts to the local Mailpit catcher so the demo
shows a real mailbox containing its link. A production transport is
committed only after JHEP-102 confirms the provider decision — the
protocol exists exactly so that decision changes one adapter, nothing
else.
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


def email_sender() -> EmailSender:
    """Select the transport by settings switch (`email_delivery`)."""
    if settings.email_delivery == "mailpit":
        return MailpitSender()
    return ConsoleSender()
