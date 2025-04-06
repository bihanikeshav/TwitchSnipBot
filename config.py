"""YAML + environment variable config loader."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


@dataclass
class TwitchConfig:
    channel: str = "esl_csgo"
    client_id: str = ""
    client_secret: str = ""


@dataclass
class DetectionConfig:
    window_size: int = 10
    stride: int = 5
    sequence_length: int = 12
    z_score_threshold: float = 2.5
    sensitivity: float = 0.7


@dataclass
class ClippingConfig:
    pre_highlight: int = 15
    post_highlight: int = 10
    format: str = "mp4"
    quality: str = "720p"


@dataclass
class CompilationConfig:
    order_by: str = "category"
    transition: str = "crossfade"
    transition_duration: float = 0.5


@dataclass
class ModelConfig:
    type: str = "lstm"
    checkpoint: str = "models/best.pt"
    onnx_path: str = "models/highlight.onnx"
    hidden_size: int = 128
    num_layers: int = 2
    dropout: float = 0.3
    input_size: int = 12
    num_classes: int = 4


@dataclass
class YouTubeConfig:
    enabled: bool = False
    privacy: str = "unlisted"
    category: str = "20"


@dataclass
class UploadConfig:
    youtube: YouTubeConfig = field(default_factory=YouTubeConfig)


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8000


@dataclass
class Config:
    twitch: TwitchConfig = field(default_factory=TwitchConfig)
    detection: DetectionConfig = field(default_factory=DetectionConfig)
    clipping: ClippingConfig = field(default_factory=ClippingConfig)
    compilation: CompilationConfig = field(default_factory=CompilationConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    upload: UploadConfig = field(default_factory=UploadConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    plugins: dict[str, Any] = field(default_factory=lambda: {"enabled": ["csgo"]})


def _apply_dict(obj: Any, data: dict) -> None:
    """Recursively apply dict values to a dataclass instance."""
    for key, value in data.items():
        if not hasattr(obj, key):
            continue
        current = getattr(obj, key)
        if isinstance(current, (TwitchConfig, DetectionConfig, ClippingConfig,
                                CompilationConfig, ModelConfig, YouTubeConfig,
                                UploadConfig, ServerConfig)) and isinstance(value, dict):
            _apply_dict(current, value)
        else:
            setattr(obj, key, value)


def load_config(config_path: str | Path | None = None) -> Config:
    """Load config from YAML file + environment variables.

    Priority: env vars > YAML > defaults.
    """
    load_dotenv()

    cfg = Config()

    # Load YAML if exists
    if config_path is None:
        config_path = Path("config.yaml")
    else:
        config_path = Path(config_path)

    if config_path.exists():
        with open(config_path) as f:
            data = yaml.safe_load(f) or {}
        _apply_dict(cfg, data)

    # Override with env vars
    if os.getenv("TWITCH_CLIENT_ID"):
        cfg.twitch.client_id = os.environ["TWITCH_CLIENT_ID"]
    if os.getenv("TWITCH_CLIENT_SECRET"):
        cfg.twitch.client_secret = os.environ["TWITCH_CLIENT_SECRET"]

    return cfg
