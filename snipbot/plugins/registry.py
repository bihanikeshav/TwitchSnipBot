"""Plugin discovery and loading for the SnipBot plugin system."""

from __future__ import annotations

import importlib
import importlib.metadata
import logging
import sys
from pathlib import Path
from typing import Any

from .base import Plugin

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "snipbot.plugins"
USER_PLUGIN_DIR = Path.home() / ".snipbot" / "plugins"


class PluginRegistry:
    """Discovers, loads, and manages SnipBot plugins."""

    def __init__(self) -> None:
        self._available: dict[str, _PluginEntry] = {}
        self._loaded: dict[str, Plugin] = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def discover(self) -> None:
        """Scan entry-points and the user plugin directory for plugins."""
        self._discover_entry_points()
        self._discover_directory(USER_PLUGIN_DIR)

    def _discover_entry_points(self) -> None:
        """Find plugins registered via setuptools / pyproject entry-points."""
        try:
            eps = importlib.metadata.entry_points()
            # Python 3.12+ returns a SelectableGroups-like object; older
            # versions return a dict.  Handle both.
            if hasattr(eps, "select"):
                group_eps = eps.select(group=ENTRY_POINT_GROUP)
            else:
                group_eps = eps.get(ENTRY_POINT_GROUP, [])

            for ep in group_eps:
                self._available[ep.name] = _PluginEntry(
                    name=ep.name,
                    loader=lambda _ep=ep: _ep.load(),
                )
                logger.debug("Discovered entry-point plugin: %s", ep.name)
        except Exception:
            logger.debug("Entry-point discovery failed", exc_info=True)

    def _discover_directory(self, directory: Path) -> None:
        """Find plugins inside *directory* (each sub-folder with a plugin.py)."""
        if not directory.is_dir():
            logger.debug("Plugin directory does not exist: %s", directory)
            return

        # Add the plugin directory to sys.path so imports resolve.
        dir_str = str(directory)
        if dir_str not in sys.path:
            sys.path.insert(0, dir_str)

        for child in sorted(directory.iterdir()):
            if not child.is_dir():
                continue
            plugin_module_path = child / "plugin.py"
            if not plugin_module_path.exists():
                continue

            plugin_name = child.name
            module_name = f"{plugin_name}.plugin"

            def _make_loader(mod_name: str = module_name) -> Any:
                mod = importlib.import_module(mod_name)
                # Expect the module to expose a class whose name ends with
                # "Plugin", or a top-level ``plugin_class`` attribute.
                cls = getattr(mod, "plugin_class", None)
                if cls is None:
                    for attr_name in dir(mod):
                        obj = getattr(mod, attr_name)
                        if (
                            isinstance(obj, type)
                            and issubclass(obj, Plugin)
                            and obj is not Plugin
                        ):
                            cls = obj
                            break
                if cls is None:
                    raise RuntimeError(
                        f"No Plugin subclass found in {mod_name}"
                    )
                return cls

            self._available[plugin_name] = _PluginEntry(
                name=plugin_name,
                loader=_make_loader,
            )
            logger.debug("Discovered directory plugin: %s", plugin_name)

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load(self, name: str) -> Plugin:
        """Load and instantiate a plugin by *name*.

        Returns the cached instance if already loaded.

        Raises ``KeyError`` if the plugin has not been discovered.
        Raises ``RuntimeError`` if the plugin fails to load.
        """
        if name in self._loaded:
            return self._loaded[name]

        if name not in self._available:
            raise KeyError(
                f"Plugin '{name}' not found. "
                f"Available: {', '.join(sorted(self._available))}"
            )

        entry = self._available[name]
        try:
            cls = entry.loader()
            instance = cls()
            if not isinstance(instance, Plugin):
                raise TypeError(
                    f"{cls!r} is not a subclass of snipbot.plugins.base.Plugin"
                )
            self._loaded[name] = instance
            logger.info("Loaded plugin: %s v%s", instance.name(), instance.version())
            return instance
        except Exception as exc:
            raise RuntimeError(f"Failed to load plugin '{name}': {exc}") from exc

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------

    def get_enabled(self, config: dict) -> list[Plugin]:
        """Return loaded instances for every plugin enabled in *config*.

        ``config`` is expected to have a ``plugins.enabled`` key that is
        either a list of plugin names or the string ``"all"``.

        Example config fragment::

            {
                "plugins": {
                    "enabled": ["csgo", "valorant"]
                }
            }
        """
        plugins_cfg = config.get("plugins", {})
        enabled = plugins_cfg.get("enabled", [])

        if enabled == "all":
            names = list(self._available)
        elif isinstance(enabled, list):
            names = enabled
        else:
            logger.warning("Invalid plugins.enabled value: %r", enabled)
            return []

        result: list[Plugin] = []
        for name in names:
            try:
                result.append(self.load(name))
            except (KeyError, RuntimeError):
                logger.warning("Could not load plugin '%s'", name, exc_info=True)
        return result

    def list_available(self) -> list[tuple[str, str]]:
        """Return ``(name, version)`` tuples for every discovered plugin.

        The version is resolved by attempting to load the plugin.  If
        loading fails the version falls back to ``"unknown"``.
        """
        result: list[tuple[str, str]] = []
        for name in sorted(self._available):
            try:
                instance = self.load(name)
                result.append((name, instance.version()))
            except (KeyError, RuntimeError):
                result.append((name, "unknown"))
        return result


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------


class _PluginEntry:
    """Lightweight descriptor for a discovered-but-not-yet-loaded plugin."""

    __slots__ = ("name", "loader")

    def __init__(self, name: str, loader: Any) -> None:
        self.name = name
        self.loader = loader
