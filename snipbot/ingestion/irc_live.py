"""Async real-time Twitch IRC client for read-only chat ingestion.

Connects anonymously as a ``justinfan`` user so no OAuth token is
required.  Incoming PRIVMSG lines are parsed into
:class:`~snipbot.ingestion.message.ChatMessage` objects and yielded via
an async generator.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from typing import AsyncIterator

from snipbot.ingestion.message import ChatMessage

logger = logging.getLogger(__name__)

_TWITCH_IRC_HOST = "irc.chat.twitch.tv"
_TWITCH_IRC_PORT = 6667

# Regex to extract useful fields from a PRIVMSG line.
# Example:
#   :username!username@username.tmi.twitch.tv PRIVMSG #channel :message text
_PRIVMSG_RE = re.compile(
    r"^(?:@(?P<tags>\S+)\s+)?"           # optional IRCv3 tags
    r":(?P<nick>[^!]+)!\S+\s+"           # :nick!user@host
    r"PRIVMSG\s+#(?P<channel>\S+)\s+"    # PRIVMSG #channel
    r":(?P<text>.*)$",                   # :message body
)

# Common Twitch emotes / BTTV / FFZ that we can detect without the API.
# A more complete implementation would use the Twitch Emotes API.
_KNOWN_EMOTES = frozenset({
    "Kappa", "PogChamp", "LUL", "LULW", "OMEGALUL", "Kreygasm",
    "BibleThump", "ResidentSleeper", "Jebaited", "monkaS", "monkaW",
    "PepeHands", "FeelsBadMan", "FeelsGoodMan", "KEKW", "PogU",
    "Pog", "Sadge", "EZ", "COPIUM", "HOPIUM", "Clap", "catJAM",
    "pepeLaugh", "Pepega", "widepeepoHappy", "peepoClap",
    "HeyGuys", "VoHiYo", "SeemsGood", "NotLikeThis", "WutFace",
    "CoolStoryBob", "DansGame", "TriHard", "4Head", "cmonBruh",
})


def _parse_emotes_from_text(text: str) -> list[str]:
    """Detect known emotes present in *text*."""
    tokens = set(text.split())
    return sorted(tokens & _KNOWN_EMOTES)


def _parse_emotes_from_tags(tag_string: str) -> list[str]:
    """Extract emote names from the IRCv3 ``emotes`` tag.

    The tag value looks like ``emote_id:start-end,start-end/emote_id:...``
    but it does **not** contain the actual emote name, so we fall back to
    text-based detection in the caller.  This helper is kept as a stub
    for future API-backed resolution.
    """
    # Stub — tag-based emote resolution requires an emote-name lookup
    # table which is outside the scope of anonymous ingestion.
    return []


class TwitchIRCClient:
    """Async read-only Twitch IRC client.

    Parameters:
        channel: Twitch channel name to join (without the ``#`` prefix).
        nick:    IRC nickname.  Defaults to a random ``justinfanNNNNN``.
    """

    def __init__(self, channel: str, *, nick: str | None = None) -> None:
        self.channel = channel.lstrip("#").lower()
        self.nick = nick or f"justinfan{random.randint(10000, 99999)}"
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    async def _connect(self) -> None:
        """Open a TCP connection to Twitch IRC and join the channel."""
        logger.info("Connecting to %s:%d as %s ...",
                     _TWITCH_IRC_HOST, _TWITCH_IRC_PORT, self.nick)
        self._reader, self._writer = await asyncio.open_connection(
            _TWITCH_IRC_HOST, _TWITCH_IRC_PORT,
        )
        # Authenticate (anonymous — password is ignored by Twitch for
        # justinfan accounts).
        self._send(f"PASS oauth:anonymous")
        self._send(f"NICK {self.nick}")
        # Request IRCv3 capabilities for tags (emotes, badges, etc.).
        self._send("CAP REQ :twitch.tv/tags twitch.tv/commands")
        self._send(f"JOIN #{self.channel}")
        logger.info("Joined #%s", self.channel)

    def _send(self, line: str) -> None:
        """Send a raw IRC line (appends CRLF)."""
        if self._writer is None:
            raise RuntimeError("Not connected")
        self._writer.write((line + "\r\n").encode("utf-8"))

    async def _close(self) -> None:
        """Gracefully close the IRC connection."""
        if self._writer is not None:
            try:
                self._send(f"PART #{self.channel}")
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            finally:
                self._writer = None
                self._reader = None

    # ------------------------------------------------------------------
    # Line parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_privmsg(line: str) -> ChatMessage | None:
        """Attempt to parse a raw IRC line into a ChatMessage.

        Returns ``None`` if the line is not a PRIVMSG.
        """
        match = _PRIVMSG_RE.match(line)
        if match is None:
            return None

        nick = match.group("nick")
        channel = match.group("channel")
        text = match.group("text")

        # Detect /me actions (CTCP ACTION).
        is_action = False
        if text.startswith("\x01ACTION ") and text.endswith("\x01"):
            text = text[8:-1]
            is_action = True

        emotes = _parse_emotes_from_text(text)

        return ChatMessage(
            username=nick,
            text=text,
            timestamp=time.time(),
            channel=channel,
            emotes=emotes,
            is_action=is_action,
        )

    # ------------------------------------------------------------------
    # Public async generator
    # ------------------------------------------------------------------

    async def messages(self) -> AsyncIterator[ChatMessage]:
        """Async generator that yields ChatMessage objects.

        Automatically handles PING/PONG keep-alive.  Reconnects on
        unexpected disconnections.
        """
        await self._connect()
        assert self._reader is not None  # noqa: S101

        try:
            while True:
                raw = await self._reader.readline()
                if not raw:
                    logger.warning("Connection lost — reconnecting ...")
                    await self._close()
                    await asyncio.sleep(2)
                    await self._connect()
                    assert self._reader is not None  # noqa: S101
                    continue

                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                # Keep-alive.
                if line.startswith("PING"):
                    pong_payload = line[5:]  # everything after "PING "
                    self._send(f"PONG {pong_payload}")
                    continue

                msg = self._parse_privmsg(line)
                if msg is not None:
                    yield msg
        finally:
            await self._close()
