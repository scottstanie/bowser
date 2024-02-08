# import secrets
from typing import Union

from pydantic import AnyHttpUrl, validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATASET_CONFIG_FILE: str = "bowser_rasters.json"
    # DATA_FILES: List[str] = []
    # DATA_DIR: Optional[str] = None
    # DATA_EXT: str = "tif"
    LOG_LEVEL: str = "WARNING"

    # SECRET_KEY: str = secrets.token_urlsafe(32)
    # SERVER_NAME: str
    # SERVER_HOST: AnyHttpUrl
    # BACKEND_CORS_ORIGINS is a JSON-formatted list of origins
    # e.g: '["http://localhost", "http://localhost:4200", "http://localhost:3000", \
    # "http://localhost:8080", "http://local.dockertoolbox.tiangolo.com"]'
    BACKEND_CORS_ORIGINS: list[AnyHttpUrl] = []
    DOMAIN: str = "localhost"

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: Union[str, list[str]]) -> Union[list[str], str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (str, list)):
            return v
        raise ValueError(v)

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
