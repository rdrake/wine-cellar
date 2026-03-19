"""D1/SQLite schema reference. The SQL migration files are the source of truth.
This module provides the schema SQL for use in tests."""

from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"

BATCH_STAGES = (
    "must_prep",
    "primary_fermentation",
    "secondary_fermentation",
    "stabilization",
    "bottling",
)

ALL_STAGES = (
    "receiving", "crushing", "must_prep",
    "primary_fermentation", "pressing",
    "secondary_fermentation", "malolactic",
    "stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering",
    "bottling", "bottle_aging",
)

WINE_TYPES = ("red", "white", "rosé", "orange", "sparkling", "dessert")

SOURCE_MATERIALS = ("kit", "juice_bucket", "fresh_grapes")

BATCH_STATUSES = ("active", "completed", "archived", "abandoned")

ACTIVITY_TYPES = ("addition", "racking", "measurement", "tasting", "note", "adjustment")

# Map batch waypoints to allowed activity stages
WAYPOINT_ALLOWED_STAGES: dict[str, tuple[str, ...]] = {
    "must_prep": ("receiving", "crushing", "must_prep"),
    "primary_fermentation": ("primary_fermentation", "pressing"),
    "secondary_fermentation": ("secondary_fermentation", "malolactic"),
    "stabilization": ("stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"),
    "bottling": ("bottling", "bottle_aging"),
}

# Ordered waypoints for /advance
WAYPOINT_ORDER = list(BATCH_STAGES)


def get_migration_sql() -> str:
    """Read the initial migration SQL for use in tests."""
    migration_file = MIGRATIONS_DIR / "0001_initial.sql"
    return migration_file.read_text()
