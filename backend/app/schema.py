"""HIVE-375 versioned home-summary contract (HomeSummaryV1) + HIVE-603
activity stream contract (HomeActivityEventV1).

Every widget carries its own `status` so the SPA renders shell+skeletons
instantly and hydrates each independently; the envelope is ALWAYS returned
200 (partial) — a slow/down source degrades ONE widget, never the page.
"""
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator

SUMMARY_VERSION = 1
ACTIVITY_VERSION = 1


class WidgetStatus(str, Enum):
    ok = "ok"
    degraded = "degraded"      # partial data (some sub-source failed)
    stale = "stale"            # served from cache after a source timeout/failure
    unauthorized = "unauthorized"  # caller not authorized for this widget's data
    empty = "empty"            # authorized, nothing to show


class Widget(BaseModel):
    status: WidgetStatus
    as_of: Optional[str] = None
    data: Any = None

    @classmethod
    def ok_(cls, data, as_of=None):
        return cls(status=WidgetStatus.ok, data=data, as_of=as_of)

    @classmethod
    def degraded_(cls, data=None, as_of=None):
        return cls(status=WidgetStatus.degraded, data=data, as_of=as_of)

    @classmethod
    def stale_(cls, data=None, as_of=None):
        return cls(status=WidgetStatus.stale, data=data, as_of=as_of)

    @classmethod
    def unauthorized_(cls):
        return cls(status=WidgetStatus.unauthorized, data=None)

    @classmethod
    def empty_(cls, as_of=None):
        return cls(status=WidgetStatus.empty, data=None, as_of=as_of)


class OrgRef(BaseModel):
    id: int
    role: str
    name: Optional[str] = None
    slug: Optional[str] = None


class HomeSummaryV1(BaseModel):
    version: int = Field(default=SUMMARY_VERSION)
    generated_at: str
    org_id: Optional[int] = None
    orgs: list[OrgRef] = Field(default_factory=list)
    widgets: dict[str, Widget] = Field(default_factory=dict)


class HomeActivityV1(BaseModel):
    """HIVE-602 live-theater payload: the org's autonomous work, happening.

    widgets.feed   — merged newest-first events (Pulse activity + comments)
    widgets.agents — the fleet as live entities (who, role, model, state)
    """
    version: int = 1
    generated_at: str
    org_id: Optional[int] = None
    widgets: dict[str, Widget] = Field(default_factory=dict)


# ---- HIVE-603 activity stream contract ---------------------------------------

class EventSource(str, Enum):
    pulse = "pulse"
    hive = "hive"
    connect = "connect"


class EventType(str, Enum):
    task_comment = "task.comment"
    task_transition = "task.transition"
    task_assignment = "task.assignment"
    task_pr_link = "task.pr_link"
    agent_status = "agent.status"
    agent_task_focus = "agent.task_focus"
    agent_message_summary = "agent.message_summary"


class RedactionLevel(str, Enum):
    none = "none"
    metadata_only = "metadata_only"
    suppressed = "suppressed"


class EventPriority(str, Enum):
    normal = "normal"
    high = "high"
    urgent = "urgent"


class ActorKind(str, Enum):
    agent = "agent"
    user = "user"
    system = "system"


class TargetKind(str, Enum):
    task = "task"
    agent = "agent"
    conversation = "conversation"
    project = "project"


class ActivityActor(BaseModel):
    kind: ActorKind = ActorKind.system
    username: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None


class ActivityTarget(BaseModel):
    kind: TargetKind = TargetKind.task
    key: Optional[str] = None
    title: Optional[str] = None
    href: Optional[str] = None


class HomeActivityEventV1(BaseModel):
    """Single activity event, matching the HLD contract §4.

    Enforces:
    - ``version`` must be exactly 1 (no forward-compat for unknown schemas).
    - Connect source events must be ``agent.message_summary`` with
      ``redaction=metadata_only`` (HLD §5.3/8: Connect is metadata-only;
      raw DM bodies are never emitted).
    """
    version: int = Field(default=ACTIVITY_VERSION)
    id: str  # Redis Stream id
    source: EventSource
    type: EventType
    occurred_at: str
    org_id: int
    project_key: Optional[str] = None
    actor: ActivityActor = Field(default_factory=ActivityActor)
    target: ActivityTarget = Field(default_factory=ActivityTarget)
    summary: str = ""
    redaction: RedactionLevel = RedactionLevel.none
    priority: EventPriority = EventPriority.normal
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _enforce_contract(self) -> "HomeActivityEventV1":
        # version must be exactly 1
        if self.version != ACTIVITY_VERSION:
            raise ValueError(
                f"Unsupported event version {self.version}; expected {ACTIVITY_VERSION}"
            )
        # Connect is metadata-only: must be agent.message_summary + metadata_only
        if self.source == EventSource.connect:
            if self.type != EventType.agent_message_summary:
                raise ValueError(
                    f"Connect source requires type=agent.message_summary, got {self.type}"
                )
            if self.redaction != RedactionLevel.metadata_only:
                raise ValueError(
                    f"Connect source requires redaction=metadata_only, got {self.redaction}"
                )
        return self


class ActivityRecentResponse(BaseModel):
    events: list[HomeActivityEventV1] = Field(default_factory=list)
    cursor_by_org: dict[str, str] = Field(default_factory=dict)
    degraded_sources: list[str] = Field(default_factory=list)
