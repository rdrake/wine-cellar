import pytest
from pydantic import ValidationError

from src.models import (
    ActivityCreate,
    AdditionDetails,
    BatchCreate,
    MeasurementDetails,
    NoteDetails,
    RackingDetails,
    WineType,
)


def test_batch_create_valid():
    batch = BatchCreate(
        name="2026 Merlot",
        wine_type=WineType.RED,
        source_material="fresh_grapes",
        started_at="2026-03-19T10:00:00Z",
    )
    assert batch.name == "2026 Merlot"


def test_batch_create_invalid_wine_type():
    with pytest.raises(ValidationError):
        BatchCreate(
            name="Bad", wine_type="beer", source_material="kit",
            started_at="2026-03-19T10:00:00Z",
        )


def test_activity_create_addition():
    activity = ActivityCreate(
        stage="must_prep",
        type="addition",
        title="Added K-meta",
        details=AdditionDetails(chemical="K-meta", amount=0.25, unit="tsp"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.chemical == "K-meta"


def test_activity_create_measurement():
    activity = ActivityCreate(
        stage="must_prep",
        type="measurement",
        title="pH reading",
        details=MeasurementDetails(metric="pH", value=3.4, unit="pH"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.value == 3.4


def test_activity_create_racking():
    activity = ActivityCreate(
        stage="secondary_fermentation",
        type="racking",
        title="Racked to carboy",
        details=RackingDetails(from_vessel="primary bucket", to_vessel="glass carboy"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.to_vessel == "glass carboy"


def test_activity_create_note_no_details():
    activity = ActivityCreate(
        stage="must_prep",
        type="note",
        title="Smells good",
        details=NoteDetails(),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details is not None


def test_activity_create_type_details_mismatch():
    with pytest.raises(ValidationError):
        ActivityCreate(
            stage="must_prep",
            type="addition",
            title="Wrong details type",
            details=NoteDetails(),
            recorded_at="2026-03-19T10:00:00Z",
        )


def test_activity_create_invalid_stage():
    with pytest.raises(ValidationError):
        ActivityCreate(
            stage="invalid_stage",
            type="note",
            title="Bad",
            details=NoteDetails(),
            recorded_at="2026-03-19T10:00:00Z",
        )
