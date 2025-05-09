"""Emote registry for Twitch, BTTV, and FFZ emotes."""

import logging
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hardcoded fallback set of ~50 common Twitch / community emotes
# ---------------------------------------------------------------------------
_DEFAULT_EMOTES: set[str] = {
    # Twitch global
    "Kappa",
    "PogChamp",
    "LUL",
    "OMEGALUL",
    "4Head",
    "BibleThump",
    "ResidentSleeper",
    "Kreygasm",
    "SwiftRage",
    "NotLikeThis",
    "FailFish",
    "DansGame",
    "WutFace",
    "BabyRage",
    "HeyGuys",
    "VoHiYo",
    "Jebaited",
    "TriHard",
    "CoolStoryBob",
    "SeemsGood",
    "TwitchRPG",
    "PJSalt",
    "OSFrog",
    "MingLee",
    "BloodTrail",
    "TBAngel",
    "SMOrc",
    "cmonBruh",
    "KomodoHype",
    "PogU",
    "Pepega",
    "monkaS",
    "monkaW",
    "KEKW",
    "PepeHands",
    "Sadge",
    "EZ",
    "COPIUM",
    "Clap",
    "peepoHappy",
    "peepoSad",
    "FeelsBadMan",
    "FeelsGoodMan",
    "HYPERS",
    "widepeepoHappy",
    "widepeepoSad",
    "catJAM",
    "POGGERS",
    "PepeLaugh",
    "5Head",
    "pepeMeltdown",
}


class EmoteRegistry:
    """Registry that aggregates emotes from Twitch, BTTV, and FFZ.

    Usage::

        registry = EmoteRegistry()
        await registry.load_bttv_emotes("channel_id_123")
        await registry.load_ffz_emotes("channel_id_123")

        if registry.is_emote("Kappa"):
            ...

        found = registry.extract_emotes("wow PogChamp that was insane LUL")
        # ["PogChamp", "LUL"]
    """

    def __init__(self) -> None:
        self._emotes: set[str] = set(_DEFAULT_EMOTES)

    # ------------------------------------------------------------------
    # Loading methods
    # ------------------------------------------------------------------

    def load_twitch_emotes(self) -> None:
        """Load the hardcoded set of common Twitch emotes.

        This is called implicitly by ``__init__`` via the default set, but
        can be called again to reset back to defaults.
        """
        self._emotes.update(_DEFAULT_EMOTES)

    async def load_bttv_emotes(self, channel_id: Optional[str] = None) -> int:
        """Fetch emotes from the BetterTTV API and add them to the registry.

        Args:
            channel_id: Twitch channel / user ID. If ``None``, loads only
                global BTTV emotes.

        Returns:
            Number of new emotes added.
        """
        added = 0

        try:
            async with aiohttp.ClientSession() as session:
                # Global emotes
                async with session.get(
                    "https://api.betterttv.net/3/cached/emotes/global",
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for emote in data:
                            code = emote.get("code")
                            if code and code not in self._emotes:
                                self._emotes.add(code)
                                added += 1

                # Channel-specific emotes
                if channel_id:
                    url = f"https://api.betterttv.net/3/cached/users/twitch/{channel_id}"
                    async with session.get(
                        url, timeout=aiohttp.ClientTimeout(total=10)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for emote in data.get("channelEmotes", []) + data.get("sharedEmotes", []):
                                code = emote.get("code")
                                if code and code not in self._emotes:
                                    self._emotes.add(code)
                                    added += 1

        except Exception:
            logger.warning("Failed to load BTTV emotes", exc_info=True)

        logger.info("Loaded %d new BTTV emotes (total: %d)", added, len(self._emotes))
        return added

    async def load_ffz_emotes(self, channel_id: Optional[str] = None) -> int:
        """Fetch emotes from the FrankerFaceZ API and add them to the registry.

        Args:
            channel_id: Twitch channel / user ID. If ``None``, loads only
                global FFZ emotes.

        Returns:
            Number of new emotes added.
        """
        added = 0

        try:
            async with aiohttp.ClientSession() as session:
                # Global emotes
                async with session.get(
                    "https://api.frankerfacez.com/v1/set/global",
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for set_id in data.get("default_sets", []):
                            emote_set = data.get("sets", {}).get(str(set_id), {})
                            for emote in emote_set.get("emoticons", []):
                                code = emote.get("name")
                                if code and code not in self._emotes:
                                    self._emotes.add(code)
                                    added += 1

                # Channel-specific emotes
                if channel_id:
                    url = f"https://api.frankerfacez.com/v1/room/id/{channel_id}"
                    async with session.get(
                        url, timeout=aiohttp.ClientTimeout(total=10)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for _set_id, emote_set in data.get("sets", {}).items():
                                for emote in emote_set.get("emoticons", []):
                                    code = emote.get("name")
                                    if code and code not in self._emotes:
                                        self._emotes.add(code)
                                        added += 1

        except Exception:
            logger.warning("Failed to load FFZ emotes", exc_info=True)

        logger.info("Loaded %d new FFZ emotes (total: %d)", added, len(self._emotes))
        return added

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def is_emote(self, word: str) -> bool:
        """Check whether a word is a known emote."""
        return word in self._emotes

    def extract_emotes(self, text: str) -> list[str]:
        """Extract all emote names found in the given text.

        Splits on whitespace and returns emotes in the order they appear.
        Duplicates are preserved.

        Args:
            text: Chat message or other text to scan.

        Returns:
            List of emote codes found in the text.
        """
        return [word for word in text.split() if word in self._emotes]

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def add_emote(self, code: str) -> None:
        """Manually add a single emote to the registry."""
        self._emotes.add(code)

    def add_emotes(self, codes: set[str]) -> None:
        """Manually add multiple emotes to the registry."""
        self._emotes.update(codes)

    @property
    def count(self) -> int:
        """Return the total number of registered emotes."""
        return len(self._emotes)

    @property
    def all_emotes(self) -> frozenset[str]:
        """Return a frozen copy of all registered emote codes."""
        return frozenset(self._emotes)
