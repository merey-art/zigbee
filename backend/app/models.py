from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """Dashboard login account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )


class Company(Base):
    """Tenant / company within one building (groups sensors for filtering)."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )


class DeviceCompany(Base):
    """Maps canonical Zigbee IEEE address to a company."""

    __tablename__ = "device_companies"

    device_ieee: Mapped[str] = mapped_column(String(36), primary_key=True)
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class SensorReading(Base):
    """One scalar metric reading from a Zigbee sensor."""

    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )

    __table_args__ = (
        # Composite index to speed up per-device metric queries
        Index("ix_sr_device_metric_time", "device_id", "metric", "recorded_at"),
    )


# DDL helper — called once at startup to ensure the hypertable exists.
HYPERTABLE_SQL = """
SELECT create_hypertable(
    'sensor_readings',
    'recorded_at',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);
"""
