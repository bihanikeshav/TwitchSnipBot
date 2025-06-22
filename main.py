"""TwitchSnipBot CLI entry point."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="snipbot",
        description="Detect Twitch stream highlights via chat analysis and auto-clip them.",
    )
    sub = parser.add_subparsers(dest="command", help="Available commands")

    # --- live ---
    live = sub.add_parser("live", help="Monitor a live Twitch channel for highlights")
    live.add_argument("channel", help="Twitch channel name")
    live.add_argument("--sensitivity", type=float, default=0.7, help="Detection sensitivity 0-1")
    live.add_argument("--model", default=None, help="Path to model checkpoint")
    live.add_argument("--statistical", action="store_true", help="Use statistical detection instead of LSTM")

    # --- batch ---
    batch = sub.add_parser("batch", help="Process a chat log file offline")
    batch.add_argument("log_path", help="Path to chat log file")
    batch.add_argument("--vod", default=None, help="Path or URL to VOD for clip extraction")
    batch.add_argument("--output", "-o", default="output", help="Output directory for clips")
    batch.add_argument("--compile", action="store_true", help="Compile clips into highlight reel")

    # --- train ---
    train = sub.add_parser("train", help="Train the LSTM model")
    train.add_argument("--data-dir", default="data", help="Directory with labeled data")
    train.add_argument("--epochs", type=int, default=50)
    train.add_argument("--lr", type=float, default=1e-3)
    train.add_argument("--checkpoint", default="models/best.pt", help="Save checkpoint path")
    train.add_argument("--bidirectional", action="store_true")

    # --- label ---
    label = sub.add_parser("label", help="Auto-label or manually annotate training data")
    label.add_argument("log_path", help="Path to chat log file")
    label.add_argument("--auto", action="store_true", help="Auto-label using Z-score")
    label.add_argument("--annotate", action="store_true", help="Interactive annotation UI")
    label.add_argument("--threshold", type=float, default=2.5, help="Z-score threshold for auto-labeling")

    # --- export ---
    export = sub.add_parser("export", help="Export model to ONNX for web app")
    export.add_argument("--checkpoint", default="models/best.pt")
    export.add_argument("--output", default="models/highlight.onnx")

    # --- server ---
    server = sub.add_parser("server", help="Start the web dashboard backend")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8000)

    # --- clip ---
    clip = sub.add_parser("clip", help="Extract clips from a VOD")
    clip.add_argument("vod", help="VOD path or Twitch VOD URL")
    clip.add_argument("--moments", required=True, help="JSON file with detected moments")
    clip.add_argument("--output", "-o", default="output")
    clip.add_argument("--compile", action="store_true")

    # --- upload ---
    upload = sub.add_parser("upload", help="Upload a clip or highlight reel to YouTube")
    upload.add_argument("video_path", help="Path to video file")
    upload.add_argument("--title", required=True)
    upload.add_argument("--description", default="")
    upload.add_argument("--tags", nargs="*", default=[])
    upload.add_argument("--privacy", default="unlisted", choices=["public", "unlisted", "private"])

    return parser.parse_args()


def _config_to_dict(config) -> dict:
    """Convert dataclass config to nested dict for pipeline consumption."""
    from dataclasses import asdict
    return asdict(config)


def cmd_live(args: argparse.Namespace) -> None:
    from config import load_config
    from snipbot.pipeline.realtime import LivePipeline

    config = load_config()
    config.twitch.channel = args.channel
    config.detection.sensitivity = args.sensitivity

    cfg_dict = _config_to_dict(config)
    if args.model:
        cfg_dict["model"]["checkpoint"] = args.model

    pipeline = LivePipeline(
        channel=args.channel,
        config=cfg_dict,
    )

    def on_highlight(moment):
        cat = moment.category
        score = moment.detection_score
        print(f"\n*** HIGHLIGHT DETECTED [{cat}] (score: {score:.2f}) ***")
        if moment.game_events:
            for ev in moment.game_events:
                print(f"  Game event: {ev.event_type} — {ev.data}")

    pipeline.on_highlight(on_highlight)

    print(f"Monitoring #{args.channel} for highlights...")
    print("Press Ctrl+C to stop.\n")
    asyncio.run(pipeline.run())


def cmd_batch(args: argparse.Namespace) -> None:
    from config import load_config
    from snipbot.pipeline.batch import run_batch_pipeline

    config = load_config()
    Path(args.output).mkdir(parents=True, exist_ok=True)

    cfg_dict = _config_to_dict(config)

    moments = run_batch_pipeline(
        log_path=args.log_path,
        vod_path=args.vod,
        config=cfg_dict,
    )

    print(f"\nDetected {len(moments)} highlights:")
    for i, m in enumerate(moments, 1):
        print(f"  {i}. [{m.category}] score={m.detection_score:.2f} "
              f"@ {m.timestamp:.1f}s (duration: {m.duration:.1f}s)")
        if m.clip_path:
            print(f"     Clip: {m.clip_path}")


def cmd_train(args: argparse.Namespace) -> None:
    import torch
    from config import load_config
    from snipbot.model.lstm import HighlightLSTM
    from snipbot.model.train import train_model
    from snipbot.model.dataset import HighlightDataset
    from snipbot.labeling.label_store import LabelStore
    from torch.utils.data import DataLoader, random_split

    config = load_config()
    Path(args.checkpoint).parent.mkdir(parents=True, exist_ok=True)

    store = LabelStore()
    sequences, det_labels, cls_labels = store.export_dataset(
        sequence_length=config.detection.sequence_length,
    )

    if not sequences:
        print("No labeled data found. Run 'snipbot label --auto <log>' first.")
        sys.exit(1)

    dataset = HighlightDataset(sequences, det_labels, cls_labels)
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=32)

    model = HighlightLSTM(
        input_size=config.model.input_size,
        hidden_size=config.model.hidden_size,
        num_layers=config.model.num_layers,
        dropout=config.model.dropout,
        num_classes=config.model.num_classes,
        bidirectional=args.bidirectional,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    history = train_model(
        model, train_loader, val_loader,
        epochs=args.epochs, lr=args.lr, device=device,
        checkpoint_path=args.checkpoint,
    )

    print(f"\nTraining complete. Best val loss: {min(history['val_loss']):.4f}")
    print(f"Checkpoint saved to {args.checkpoint}")


def cmd_label(args: argparse.Namespace) -> None:
    from config import load_config
    from snipbot.ingestion.log_parser import parse_irc_log, parse_blast_log
    from snipbot.features.window import SlidingWindowManager
    from snipbot.features.extractors import extract_features
    from snipbot.labeling.statistical import auto_label
    from snipbot.labeling.annotation_ui import run_annotation
    from snipbot.labeling.label_store import LabelStore

    config = load_config()
    log_path = args.log_path

    # Auto-detect format
    if log_path.endswith(".json"):
        print("HLTV logs don't contain chat messages for labeling.")
        sys.exit(1)

    with open(log_path, "r", encoding="utf-8") as f:
        first_line = f.readline()

    if first_line.startswith("["):
        messages = parse_blast_log(log_path)
    else:
        messages = parse_irc_log(log_path)

    print(f"Parsed {len(messages)} messages from {log_path}")

    wm = SlidingWindowManager(
        window_size=config.detection.window_size,
        stride=config.detection.stride,
    )
    windows_raw = wm.create_windows(messages)
    windows = [extract_features(msgs, start, end) for start, end, msgs in windows_raw]
    print(f"Created {len(windows)} windows")

    store = LabelStore()

    if args.auto:
        labels = auto_label(windows, z_threshold=args.threshold)
        highlight_count = sum(1 for _, is_h in labels if is_h)
        for idx, is_highlight in labels:
            w = windows[idx]
            store.save_label(w.start_time, w.end_time, is_highlight,
                             category="other", source="auto", features=w)
        print(f"Auto-labeled {highlight_count} highlights out of {len(windows)} windows")

    if args.annotate:
        run_annotation(windows, messages, label_store=store)


def cmd_export(args: argparse.Namespace) -> None:
    import torch
    from config import load_config
    from snipbot.model.lstm import HighlightLSTM
    from snipbot.model.export_onnx import export_to_onnx

    config = load_config()
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    model = HighlightLSTM(
        input_size=config.model.input_size,
        hidden_size=config.model.hidden_size,
        num_layers=config.model.num_layers,
        num_classes=config.model.num_classes,
    )
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu"))

    export_to_onnx(model, args.output,
                   sequence_length=config.detection.sequence_length,
                   input_size=config.model.input_size)
    print(f"Exported ONNX model to {args.output}")


def cmd_server(args: argparse.Namespace) -> None:
    import uvicorn
    uvicorn.run("snipbot.server.app:app", host=args.host, port=args.port, reload=True)


def cmd_clip(args: argparse.Namespace) -> None:
    import json
    from snipbot.clipping.clip_cutter import cut_clips
    from snipbot.clipping.compiler import compile_highlights

    Path(args.output).mkdir(parents=True, exist_ok=True)

    with open(args.moments) as f:
        moments_data = json.load(f)

    time_ranges = [(m["start"], m["end"]) for m in moments_data]
    clip_paths = cut_clips(args.vod, args.output, time_ranges)

    print(f"Extracted {len(clip_paths)} clips to {args.output}")

    if args.compile and clip_paths:
        reel_path = str(Path(args.output) / "highlight_reel.mp4")
        compile_highlights(clip_paths, reel_path)
        print(f"Compiled highlight reel: {reel_path}")


def cmd_upload(args: argparse.Namespace) -> None:
    from snipbot.upload.youtube_uploader import YouTubeUploader

    uploader = YouTubeUploader()
    video_id = uploader.upload(
        video_path=args.video_path,
        title=args.title,
        description=args.description,
        tags=args.tags,
        privacy=args.privacy,
    )
    print(f"Uploaded: https://youtu.be/{video_id}")


COMMANDS = {
    "live": cmd_live,
    "batch": cmd_batch,
    "train": cmd_train,
    "label": cmd_label,
    "export": cmd_export,
    "server": cmd_server,
    "clip": cmd_clip,
    "upload": cmd_upload,
}


def main() -> None:
    args = parse_args()
    if args.command is None:
        parse_args.__wrapped__ = None  # type: ignore
        print("Usage: snipbot <command> [options]")
        print("Commands: live, batch, train, label, export, server, clip, upload")
        print("Run 'snipbot <command> --help' for details.")
        sys.exit(1)

    cmd_fn = COMMANDS.get(args.command)
    if cmd_fn:
        cmd_fn(args)


if __name__ == "__main__":
    main()
