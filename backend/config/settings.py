import os
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CSRF_TRUSTED_ORIGINS = [
    value for value in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if value
]
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "rest_framework", "documents",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "documents.middleware.CorrelationMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
database = urlparse(os.environ["DATABASE_URL"])
if database.scheme not in ("postgres", "postgresql"):
    raise ValueError("DATABASE_URL deve usar PostgreSQL.")
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": unquote(database.path.lstrip("/")),
    "USER": unquote(database.username or ""),
    "PASSWORD": unquote(database.password or ""),
    "HOST": database.hostname,
    "PORT": database.port or 5432,
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "EXCEPTION_HANDLER": "documents.middleware.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        "login": "5/min",
    },
}
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "UTC"
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_ROOT = Path(os.getenv("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media")))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
DATA_UPLOAD_MAX_MEMORY_SIZE = 16 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.redis.RedisCache",
    "LOCATION": CELERY_BROKER_URL,
    "KEY_PREFIX": "ged-ocr",
}}
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_BROKER_CONNECTION_TIMEOUT = 3
CELERY_TASK_PUBLISH_RETRY = False
CELERY_TASK_SOFT_TIME_LIMIT = 540
CELERY_TASK_TIME_LIMIT = 600
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "32768"))
if not 1024 <= LLM_MAX_OUTPUT_TOKENS <= 65536:
    raise ValueError("LLM_MAX_OUTPUT_TOKENS deve estar entre 1024 e 65536.")
OCR_DETECTION_MODEL = os.getenv("OCR_DETECTION_MODEL", "PP-OCRv5_mobile_det")
OCR_RECOGNITION_MODEL = os.getenv("OCR_RECOGNITION_MODEL", "latin_PP-OCRv5_mobile_rec")
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.7"))
if not 0 <= MIN_CONFIDENCE <= 1:
    raise ValueError("MIN_CONFIDENCE deve estar entre 0 e 1.")
TYPE_MIN_CONFIDENCE = float(os.getenv("TYPE_MIN_CONFIDENCE", "0.7"))
if not 0 <= TYPE_MIN_CONFIDENCE <= 1:
    raise ValueError("TYPE_MIN_CONFIDENCE deve estar entre 0 e 1.")
GED_URL = os.getenv("GED_URL", "")
GED_TOKEN = os.getenv("GED_TOKEN", "")
GED_TIMEOUT = int(os.getenv("GED_TIMEOUT", "30"))
# Framework request logs can contain paths, query strings or exception details.
LOGGING = {
    "version": 1, "disable_existing_loggers": True,
    "formatters": {"safe": {"format": "%(levelname)s %(message)s"}},
    "filters": {"safe_exception": {"()": "documents.logging.SafeExceptionFilter"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "safe"},
        "framework": {
            "class": "logging.StreamHandler", "formatter": "safe",
            "filters": ["safe_exception"],
        },
        "null": {"class": "logging.NullHandler"},
    },
    "root": {"handlers": ["null"], "level": "CRITICAL"},
    "loggers": {
        "documents": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django": {"handlers": ["framework"], "level": "ERROR", "propagate": False},
        "celery": {"handlers": ["framework"], "level": "ERROR", "propagate": False},
    },
}
