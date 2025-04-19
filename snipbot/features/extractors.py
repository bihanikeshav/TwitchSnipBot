"""Feature extraction for chat analysis windows.

Computes a 12-dimensional feature vector from a list of
:class:`~snipbot.ingestion.message.ChatMessage` objects that fall within
a single time window.

Feature vector layout (indices 0-11)
-------------------------------------
 0. message_rate          — messages per second
 1. unique_users          — count of distinct usernames
 2. user_ratio            — unique_users / total_messages (0 if empty)
 3. emote_density         — fraction of messages containing emotes
 4. caps_ratio            — fraction of messages that are ALL CAPS
 5. avg_message_length    — mean character count of messages
 6. message_length_variance — variance of message lengths
 7. keyword_score         — hype-keyword hits normalised by message count
 8. repetition_score      — fraction of near-duplicate messages
 9. question_ratio        — fraction of messages ending with '?'
10. exclamation_ratio     — fraction of messages ending with '!'
11. entropy               — Shannon entropy over unique-word frequencies
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Sequence

import numpy as np

from snipbot.features.feature_set import WindowFeatures
from snipbot.ingestion.message import ChatMessage

# Number of features in the vector — kept as a module constant so other
# parts of the codebase can reference it without magic numbers.
NUM_FEATURES: int = 12

# ---------------------------------------------------------------------------
# Hype-keyword list (case-insensitive matching)
# ---------------------------------------------------------------------------

_HYPE_KEYWORDS: frozenset[str] = frozenset({
    "ace",
    "clutch",
    "insane",
    "omg",
    "wtf",
    "lets go",
    "let's go",
    "pog",
    "pogchamp",
    "poggers",
    "holy",
    "wow",
    "gg",
    "ez",
    "nice",
    "noooo",
    "crazy",
    "god",
    "goat",
    "huge",
    "hype",
    "sick",
    "whoa",
    "damn",
    "rip",
    "oof",
    "lmao",
    "lol",
    "rofl",
    "sheesh",
    "bruh",
    "no way",
    "insane",
    "what",
    "vamos",
    "gg wp",
})

# Pre-compile a single pattern for multi-word keywords and single words.
_HYPE_PATTERN = re.compile(
    "|".join(re.escape(kw) for kw in sorted(_HYPE_KEYWORDS, key=len, reverse=True)),
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Individual feature functions
# ---------------------------------------------------------------------------


def _message_rate(messages: Sequence[ChatMessage], duration: float) -> float:
    if duration <= 0:
        return 0.0
    return len(messages) / duration


def _unique_users(messages: Sequence[ChatMessage]) -> float:
    return float(len({m.username for m in messages}))


def _user_ratio(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return len({m.username for m in messages}) / n


def _emote_density(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return sum(1 for m in messages if m.has_emote) / n


def _caps_ratio(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return sum(1 for m in messages if m.is_caps) / n


def _avg_message_length(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return sum(len(m.text) for m in messages) / n


def _message_length_variance(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    lengths = [len(m.text) for m in messages]
    mean = sum(lengths) / n
    return sum((l - mean) ** 2 for l in lengths) / n


def _keyword_score(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    hits = 0
    for m in messages:
        hits += len(_HYPE_PATTERN.findall(m.text))
    return hits / n


def _repetition_score(messages: Sequence[ChatMessage]) -> float:
    """Fraction of messages that are duplicates of another in the window.

    Two messages are considered *near-duplicates* when their lowercased,
    stripped text is identical.
    """
    n = len(messages)
    if n <= 1:
        return 0.0
    normalised = [m.text.strip().lower() for m in messages]
    counts = Counter(normalised)
    # A message is a "duplicate" if its normalised form appears more
    # than once.  We count every such occurrence.
    duplicate_count = sum(c for c in counts.values() if c > 1)
    return duplicate_count / n


def _question_ratio(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return sum(1 for m in messages if m.text.rstrip().endswith("?")) / n


def _exclamation_ratio(messages: Sequence[ChatMessage]) -> float:
    n = len(messages)
    if n == 0:
        return 0.0
    return sum(1 for m in messages if m.text.rstrip().endswith("!")) / n


def _entropy(messages: Sequence[ChatMessage]) -> float:
    """Shannon entropy over the frequency distribution of unique words.

    Higher entropy indicates a more diverse vocabulary in the window.
    """
    if not messages:
        return 0.0

    word_counts: Counter[str] = Counter()
    for m in messages:
        for word in m.text.lower().split():
            word_counts[word] += 1

    total = sum(word_counts.values())
    if total == 0:
        return 0.0

    ent = 0.0
    for count in word_counts.values():
        p = count / total
        if p > 0:
            ent -= p * math.log2(p)
    return ent


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_features(
    messages: list[ChatMessage],
    start_time: float,
    end_time: float,
) -> WindowFeatures:
    """Compute the 12-dimensional feature vector for a chat window.

    Parameters:
        messages:   Chat messages that fall within the window.
        start_time: Unix epoch of the window's left edge.
        end_time:   Unix epoch of the window's right edge.

    Returns:
        A :class:`~snipbot.features.feature_set.WindowFeatures` instance.
    """
    duration = end_time - start_time

    features = np.array(
        [
            _message_rate(messages, duration),        # 0
            _unique_users(messages),                  # 1
            _user_ratio(messages),                    # 2
            _emote_density(messages),                 # 3
            _caps_ratio(messages),                    # 4
            _avg_message_length(messages),            # 5
            _message_length_variance(messages),       # 6
            _keyword_score(messages),                 # 7
            _repetition_score(messages),              # 8
            _question_ratio(messages),                # 9
            _exclamation_ratio(messages),             # 10
            _entropy(messages),                       # 11
        ],
        dtype=np.float64,
    )

    return WindowFeatures(
        start_time=start_time,
        end_time=end_time,
        features=features,
        message_count=len(messages),
    )
