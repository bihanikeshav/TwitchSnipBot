"""Chat message data model for TwitchSnipBot."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ChatMessage:
    """Represents a single chat message from any ingestion source.

    Attributes:
        username:  The display name or login of the message author.
        text:      The raw message body.
        timestamp: Unix epoch timestamp (seconds) of the message.
        channel:   The Twitch channel the message was sent in.
        emotes:    List of emote codes found in the message.
        is_action: True if the message was a CTCP ACTION (/me).
    """

    username: str
    text: str
    timestamp: float
    channel: str = ""
    emotes: list[str] = field(default_factory=list)
    is_action: bool = False

    # ------------------------------------------------------------------
    # Helper properties
    # ------------------------------------------------------------------

    @property
    def is_caps(self) -> bool:
        """Return True when >70 % of alphabetic characters are uppercase.

        Short messages (3 characters or fewer after stripping whitespace)
        are never considered ALL-CAPS.
        """
        alpha_chars = [c for c in self.text if c.isalpha()]
        if len(alpha_chars) <= 3:
            return False
        upper_count = sum(1 for c in alpha_chars if c.isupper())
        return upper_count / len(alpha_chars) > 0.70

    @property
    def word_count(self) -> int:
        """Number of whitespace-delimited tokens in the message."""
        return len(self.text.split())

    @property
    def has_emote(self) -> bool:
        """True if at least one emote was detected in the message."""
        return len(self.emotes) > 0
