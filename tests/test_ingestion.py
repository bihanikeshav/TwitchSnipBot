"""Tests for the ingestion layer."""

import os
import pytest
from pathlib import Path

from snipbot.ingestion.message import ChatMessage
from snipbot.ingestion.log_parser import parse_irc_log, parse_blast_log, parse_hltv_json


DATA_DIR = Path(__file__).parent.parent / "data"


class TestChatMessage:
    def test_basic_message(self):
        msg = ChatMessage(
            username="testuser",
            text="Hello world!",
            timestamp=1000.0,
            channel="test",
        )
        assert msg.username == "testuser"
        assert msg.word_count == 2
        assert not msg.is_caps
        assert not msg.has_emote

    def test_caps_message(self):
        msg = ChatMessage(
            username="user",
            text="THIS IS ALL CAPS",
            timestamp=1000.0,
            channel="test",
        )
        assert msg.is_caps

    def test_short_caps_not_detected(self):
        msg = ChatMessage(
            username="user",
            text="OK",
            timestamp=1000.0,
            channel="test",
        )
        assert not msg.is_caps

    def test_emotes(self):
        msg = ChatMessage(
            username="user",
            text="PogChamp nice play",
            timestamp=1000.0,
            channel="test",
            emotes=["PogChamp"],
        )
        assert msg.has_emote


class TestIRCLogParser:
    def test_parse_chat_log(self):
        path = DATA_DIR / "chat.log"
        if not path.exists():
            pytest.skip("chat.log not found")

        messages = parse_irc_log(str(path))
        assert len(messages) > 0
        assert all(isinstance(m, ChatMessage) for m in messages)
        assert all(m.channel for m in messages)

    def test_parse_map1_log(self):
        path = DATA_DIR / "map1.log"
        if not path.exists():
            pytest.skip("map1.log not found")

        messages = parse_irc_log(str(path))
        assert len(messages) > 0


class TestBLASTLogParser:
    def test_parse_blast_log(self):
        path = DATA_DIR / "[12-18-22] BLASTPremier - BLAST Premier World Final, Championship Sunday BLASTtv Showmatch, Team Liquid vs G2 Esports - Chat.txt"
        if not path.exists():
            pytest.skip("BLAST log not found")

        messages = parse_blast_log(str(path))
        assert len(messages) > 0
        assert all(isinstance(m, ChatMessage) for m in messages)


class TestHLTVParser:
    def test_parse_hltv_json(self):
        path = DATA_DIR / "hltv_log.json"
        if not path.exists():
            pytest.skip("hltv_log.json not found")

        events = parse_hltv_json(str(path))
        assert len(events) > 0
        # Should contain kills and rounds
        event_types = {e.event_type for e in events}
        assert "Kill" in event_types or "kill" in event_types
