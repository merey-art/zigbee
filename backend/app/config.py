from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+asyncpg://zigbee:zigbeepass@localhost:5432/zigbee"
    )
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_base_topic: str = "zigbee2mqtt"
    cors_origins: str = "http://localhost:3000"

    jwt_secret_key: str = "change-me-in-development-only"
    jwt_expire_minutes: int = 480
    jwt_cookie_name: str = "access_token"

    admin_email: str = "admin@example.com"
    admin_password: str = "changeme123"

    # Optional: BotFather token; alerts and /me/telegram/test require this.
    telegram_bot_token: str = ""

    emergency_temp_rate: float = 2.0
    emergency_co2_rate: float = 200.0
    emergency_temp_absolute: float = 35.0
    emergency_sustained_readings: int = 2
    emergency_device_pairs: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
