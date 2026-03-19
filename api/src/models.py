from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

# --- Enums ---


class WineType(StrEnum):
    RED = "red"
    WHITE = "white"
    ROSE = "rosé"
    ORANGE = "orange"
    SPARKLING = "sparkling"
    DESSERT = "dessert"


class SourceMaterial(StrEnum):
    KIT = "kit"
    JUICE_BUCKET = "juice_bucket"
    FRESH_GRAPES = "fresh_grapes"


class BatchStage(StrEnum):
    MUST_PREP = "must_prep"
    PRIMARY_FERMENTATION = "primary_fermentation"
    SECONDARY_FERMENTATION = "secondary_fermentation"
    STABILIZATION = "stabilization"
    BOTTLING = "bottling"


class AllStage(StrEnum):
    RECEIVING = "receiving"
    CRUSHING = "crushing"
    MUST_PREP = "must_prep"
    PRIMARY_FERMENTATION = "primary_fermentation"
    PRESSING = "pressing"
    SECONDARY_FERMENTATION = "secondary_fermentation"
    MALOLACTIC = "malolactic"
    STABILIZATION = "stabilization"
    FINING = "fining"
    BULK_AGING = "bulk_aging"
    COLD_STABILIZATION = "cold_stabilization"
    FILTERING = "filtering"
    BOTTLING = "bottling"
    BOTTLE_AGING = "bottle_aging"


class BatchStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    ABANDONED = "abandoned"


class ActivityType(StrEnum):
    ADDITION = "addition"
    RACKING = "racking"
    MEASUREMENT = "measurement"
    TASTING = "tasting"
    NOTE = "note"
    ADJUSTMENT = "adjustment"


# --- Activity Detail Schemas ---


class AdditionDetails(BaseModel):
    chemical: str
    amount: float
    unit: str
    notes: str | None = None


class MeasurementDetails(BaseModel):
    metric: str
    value: float
    unit: str
    notes: str | None = None


class RackingDetails(BaseModel):
    from_vessel: str
    to_vessel: str
    notes: str | None = None


class TastingDetails(BaseModel):
    aroma: str
    flavor: str
    appearance: str
    notes: str | None = None


class AdjustmentDetails(BaseModel):
    parameter: str
    from_value: float
    to_value: float
    unit: str
    notes: str | None = None


class NoteDetails(BaseModel):
    notes: str | None = None


ActivityDetails = Annotated[
    AdditionDetails
    | MeasurementDetails
    | RackingDetails
    | TastingDetails
    | AdjustmentDetails
    | NoteDetails,
    Field(discriminator=None),
]


# --- Request Models ---


class BatchCreate(BaseModel):
    name: str
    wine_type: WineType
    source_material: SourceMaterial
    started_at: str
    volume_liters: float | None = None
    target_volume_liters: float | None = None
    notes: str | None = None


class BatchUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    volume_liters: float | None = None
    target_volume_liters: float | None = None


_TYPE_TO_DETAILS: dict[ActivityType, type] = {
    ActivityType.ADDITION: AdditionDetails,
    ActivityType.MEASUREMENT: MeasurementDetails,
    ActivityType.RACKING: RackingDetails,
    ActivityType.TASTING: TastingDetails,
    ActivityType.ADJUSTMENT: AdjustmentDetails,
    ActivityType.NOTE: NoteDetails,
}


class ActivityCreate(BaseModel):
    stage: AllStage
    type: ActivityType
    title: str
    details: ActivityDetails
    recorded_at: str

    @model_validator(mode="after")
    def validate_type_matches_details(self):
        expected = _TYPE_TO_DETAILS.get(self.type)
        if expected and not isinstance(self.details, expected):
            msg = f"details must be {expected.__name__} for type '{self.type}'"
            raise ValueError(msg)
        return self


class ActivityUpdate(BaseModel):
    title: str | None = None
    details: ActivityDetails | None = None
    recorded_at: str | None = None


class DeviceCreate(BaseModel):
    id: str
    name: str


class DeviceAssign(BaseModel):
    batch_id: str


# --- Response Models ---


class BatchResponse(BaseModel):
    id: str
    name: str
    wine_type: WineType
    source_material: SourceMaterial
    stage: BatchStage
    status: BatchStatus
    volume_liters: float | None
    target_volume_liters: float | None
    started_at: str
    completed_at: str | None
    notes: str | None
    created_at: str
    updated_at: str


class ActivityResponse(BaseModel):
    id: str
    batch_id: str
    stage: AllStage
    type: ActivityType
    title: str
    details: dict | None
    recorded_at: str
    created_at: str
    updated_at: str


class ReadingResponse(BaseModel):
    id: str
    batch_id: str | None
    device_id: str
    gravity: float
    temperature: float
    battery: float
    rssi: float
    source_timestamp: str
    created_at: str


class DeviceResponse(BaseModel):
    id: str
    name: str
    batch_id: str | None
    assigned_at: str | None
    created_at: str
    updated_at: str


class PaginatedReadings(BaseModel):
    items: list[ReadingResponse]
    next_cursor: str | None


class ErrorResponse(BaseModel):
    error: str
    message: str


# --- Webhook ---


class RaptWebhookPayload(BaseModel):
    device_id: str
    device_name: str
    temperature: float
    gravity: float
    battery: float
    rssi: float
    created_date: str
