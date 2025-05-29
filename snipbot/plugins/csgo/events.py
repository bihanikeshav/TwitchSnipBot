"""CS:GO / CS2 game-event detection.

Analyses kill and round data to surface highlight-worthy moments such as
aces, clutches, multi-kills, pistol-round upsets, knife kills, and AWP
multi-kills.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from typing import Any

from ..base import GameEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PISTOL_ROUNDS = {1, 16}  # Standard CS:GO/CS2 halves start on rounds 1 & 16.

KNIFE_WEAPONS = {"knife", "knife_t", "bayonet", "knifegg"}

AWP_WEAPONS = {"awp"}

# Thresholds
ACE_KILLS = 5
MULTI_KILL_MIN = 3  # 3k or 4k (ace is separate)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def detect_csgo_events(
    kills: list[GameEvent],
    rounds: list[GameEvent],
) -> list[GameEvent]:
    """Detect notable CS:GO events from raw kill and round data.

    Parameters
    ----------
    kills:
        ``GameEvent`` objects with ``event_type == "kill"``.  Each event's
        ``data`` dict should carry at least ``killerNick``, ``killerSide``,
        ``victimSide``, and ``weapon``.
    rounds:
        ``GameEvent`` objects with ``event_type`` in
        ``{"round_start", "round_end"}``.

    Returns
    -------
    list[GameEvent]
        Synthetic highlight events.  Each has an ``event_type`` like
        ``"ace"``, ``"clutch"``, ``"multi_kill"``, ``"pistol_upset"``,
        ``"knife_kill"``, or ``"awp_multi_kill"``.
    """
    detected: list[GameEvent] = []

    # ---- organise kills into rounds ----
    round_kills = _split_kills_by_round(kills, rounds)

    round_number = 0
    for round_idx, (rnd_kills, round_meta) in enumerate(round_kills):
        round_number = round_idx + 1

        # Per-player kill counts in this round
        killer_counts: Counter[str] = Counter()
        killer_events: defaultdict[str, list[GameEvent]] = defaultdict(list)
        knife_kills_in_round: list[GameEvent] = []
        awp_kills_per_player: defaultdict[str, list[GameEvent]] = defaultdict(list)

        for k in rnd_kills:
            killer = k.data.get("killerNick", "unknown")
            weapon = k.data.get("weapon", "").lower()
            killer_counts[killer] += 1
            killer_events[killer].append(k)

            if weapon in KNIFE_WEAPONS:
                knife_kills_in_round.append(k)
            if weapon in AWP_WEAPONS:
                awp_kills_per_player[killer].append(k)

        # -- Ace (5 kills by one player in a single round) --
        for player, count in killer_counts.items():
            if count >= ACE_KILLS:
                detected.append(
                    GameEvent(
                        event_type="ace",
                        timestamp=killer_events[player][-1].timestamp,
                        data={
                            "player": player,
                            "kills": count,
                            "round": round_number,
                            "weapons": [
                                e.data.get("weapon", "")
                                for e in killer_events[player]
                            ],
                        },
                    )
                )

        # -- Multi-kill (3k / 4k, excluding aces) --
        for player, count in killer_counts.items():
            if MULTI_KILL_MIN <= count < ACE_KILLS:
                detected.append(
                    GameEvent(
                        event_type="multi_kill",
                        timestamp=killer_events[player][-1].timestamp,
                        data={
                            "player": player,
                            "kills": count,
                            "round": round_number,
                            "label": f"{count}k",
                        },
                    )
                )

        # -- AWP multi-kill (2+ AWP kills by one player in a round) --
        for player, awp_kills in awp_kills_per_player.items():
            if len(awp_kills) >= 2:
                detected.append(
                    GameEvent(
                        event_type="awp_multi_kill",
                        timestamp=awp_kills[-1].timestamp,
                        data={
                            "player": player,
                            "awp_kills": len(awp_kills),
                            "round": round_number,
                        },
                    )
                )

        # -- Knife kill --
        for kk in knife_kills_in_round:
            detected.append(
                GameEvent(
                    event_type="knife_kill",
                    timestamp=kk.timestamp,
                    data={
                        "killer": kk.data.get("killerNick", "unknown"),
                        "victim": kk.data.get("victimNick", "unknown"),
                        "round": round_number,
                    },
                )
            )

        # -- Clutch detection (1vN win) --
        clutch = _detect_clutch(rnd_kills, round_meta)
        if clutch:
            detected.append(clutch)

        # -- Pistol-round upset --
        if round_number in PISTOL_ROUNDS:
            upset = _detect_pistol_upset(rnd_kills, round_meta, round_number)
            if upset:
                detected.append(upset)

    return detected


def classify_highlight(events: list[GameEvent]) -> str:
    """Classify a collection of highlight events into a category.

    Returns one of ``"exciting"``, ``"funny"``, ``"surprising"``, or
    ``"none"``.
    """
    if not events:
        return "none"

    types = {e.event_type for e in events}

    # Surprising: clutches and pistol upsets are unexpected outcomes.
    if types & {"clutch", "pistol_upset"}:
        return "surprising"

    # Funny: knife kills are crowd-pleasers.
    if types & {"knife_kill"}:
        return "funny"

    # Exciting: aces, multi-kills, AWP highlights.
    if types & {"ace", "multi_kill", "awp_multi_kill"}:
        return "exciting"

    return "none"


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _split_kills_by_round(
    kills: list[GameEvent],
    rounds: list[GameEvent],
) -> list[tuple[list[GameEvent], dict[str, Any]]]:
    """Group kills into rounds delimited by round_start / round_end events.

    Returns a list of ``(kills_in_round, round_meta)`` tuples.  *round_meta*
    contains the ``round_end`` data dict (scores, winner, etc.) when
    available.
    """
    # Build ordered round boundaries from round events.
    boundaries: list[tuple[float, str, dict]] = []
    for r in sorted(rounds, key=lambda e: e.timestamp):
        boundaries.append((r.timestamp, r.event_type, r.data))

    if not boundaries:
        # No round markers — treat everything as a single round.
        return [(kills, {})]

    # Pair starts and ends.
    round_groups: list[tuple[float, float, dict]] = []
    current_start: float | None = None
    for ts, etype, data in boundaries:
        if etype == "round_start":
            current_start = ts
        elif etype == "round_end":
            start = current_start if current_start is not None else ts
            round_groups.append((start, ts, data))
            current_start = None

    # If we only have ends (common in HLTV logs where RoundEnd precedes
    # kills), infer groupings by ordering kills between consecutive ends.
    if not round_groups:
        ends = [(ts, data) for ts, etype, data in boundaries if etype == "round_end"]
        if ends:
            prev = float("-inf")
            for end_ts, data in ends:
                round_groups.append((prev, end_ts, data))
                prev = end_ts

    all_kills = sorted(kills, key=lambda e: e.timestamp)
    result: list[tuple[list[GameEvent], dict]] = []

    for start_ts, end_ts, meta in round_groups:
        rnd_kills = [k for k in all_kills if start_ts <= k.timestamp <= end_ts]
        result.append((rnd_kills, meta))

    # Remaining kills that fall outside any round boundary.
    covered = {id(k) for rnd_k, _ in result for k in rnd_k}
    leftover = [k for k in all_kills if id(k) not in covered]
    if leftover:
        result.append((leftover, {}))

    return result


def _detect_clutch(
    kills: list[GameEvent],
    round_meta: dict,
) -> GameEvent | None:
    """Detect a 1vN clutch (a single player winning against N opponents).

    A clutch is identified when:
    1. A round has a winner.
    2. During the round, one side was reduced to a single player alive.
    3. That lone player got N kills to close the round.
    """
    winner_side = round_meta.get("winner")
    if not winner_side:
        return None

    # Map winner to the side string used in kill data.
    side_map = {
        "CT": "CT",
        "COUNTER_TERRORIST": "CT",
        "TERRORIST": "TERRORIST",
        "T": "TERRORIST",
    }
    winning_side = side_map.get(winner_side.upper(), winner_side)

    # Kills made by the winning side
    winning_kills = [
        k for k in kills
        if k.data.get("killerSide", "").upper() == winning_side.upper()
    ]
    if not winning_kills:
        return None

    # Count kills by each player on the winning side
    player_kills: Counter[str] = Counter()
    for k in winning_kills:
        player_kills[k.data.get("killerNick", "unknown")] += 1

    # Count how many players on the winning side got kills
    winning_players = set(player_kills.keys())

    # Heuristic: if only one player on the winning side got kills and
    # they got 2+ kills, treat it as a potential clutch.
    if len(winning_players) == 1:
        clutch_player = next(iter(winning_players))
        n_kills = player_kills[clutch_player]
        if n_kills >= 2:
            # The "N" in 1vN is approximated by kills.
            return GameEvent(
                event_type="clutch",
                timestamp=winning_kills[-1].timestamp,
                data={
                    "player": clutch_player,
                    "kills": n_kills,
                    "situation": f"1v{n_kills}",
                    "side": winning_side,
                },
            )

    return None


def _detect_pistol_upset(
    kills: list[GameEvent],
    round_meta: dict,
    round_number: int,
) -> GameEvent | None:
    """Detect a pistol-round upset.

    An upset is flagged when the losing side in the pistol round had more
    kills than the winning side yet still lost — indicating an unlikely
    outcome — *or* when the round is simply a close contest (winner had
    fewer total kills).
    """
    winner_side = round_meta.get("winner")
    if not winner_side:
        return None

    side_map = {
        "CT": "CT",
        "COUNTER_TERRORIST": "CT",
        "TERRORIST": "TERRORIST",
        "T": "TERRORIST",
    }
    winning_side = side_map.get(winner_side.upper(), winner_side)

    winning_kill_count = sum(
        1
        for k in kills
        if k.data.get("killerSide", "").upper() == winning_side.upper()
    )
    losing_kill_count = sum(
        1
        for k in kills
        if k.data.get("killerSide", "").upper() != winning_side.upper()
        and k.data.get("killerSide", "")  # skip if no side info
    )

    # Upset: losing side fragged more but still lost.
    if losing_kill_count > winning_kill_count:
        ts = kills[-1].timestamp if kills else 0.0
        return GameEvent(
            event_type="pistol_upset",
            timestamp=ts,
            data={
                "round": round_number,
                "winner": winning_side,
                "winning_kills": winning_kill_count,
                "losing_kills": losing_kill_count,
            },
        )

    return None
