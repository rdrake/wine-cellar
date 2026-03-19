import sqlite3

from src.schema import (
    ALL_STAGES,
    BATCH_STAGES,
    WAYPOINT_ALLOWED_STAGES,
    WAYPOINT_ORDER,
    get_migration_sql,
)


def test_migration_creates_all_tables():
    conn = sqlite3.connect(":memory:")
    conn.executescript(get_migration_sql())
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert tables >= {"batches", "activities", "readings", "devices"}
    conn.close()


def test_waypoint_stages_are_subset_of_all_stages():
    for _waypoint, stages in WAYPOINT_ALLOWED_STAGES.items():
        for stage in stages:
            assert stage in ALL_STAGES, f"{stage} not in ALL_STAGES"


def test_all_stages_covered_by_waypoints():
    covered = set()
    for stages in WAYPOINT_ALLOWED_STAGES.values():
        covered.update(stages)
    assert covered == set(ALL_STAGES)


def test_waypoint_order_matches_batch_stages():
    assert list(BATCH_STAGES) == WAYPOINT_ORDER
